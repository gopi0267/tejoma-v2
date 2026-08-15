/**
 * Phase 6 Evidence Intelligence API.
 *
 * ADDITIVE AND STATELESS. It reads no database, writes nothing, and sits on no existing matching
 * path. Production ranking calls nothing here, so a fault in this route degrades exactly one thing:
 * this route. That is the §41 failure-safety property, obtained structurally rather than with a
 * circuit breaker around a dependency that does not exist.
 *
 * NO MATCH SCORE (§38). The response carries evidence states, supporting units, gaps and
 * limitations. There is deliberately no percentage, no ranking key and no aggregate number a
 * consumer could sort on - a caller that wants a verdict must go to Phase 7, which does not exist
 * yet. The one numeric field, `independent_sources`, is a count of distinct evidence classes and is
 * meaningless as a ranking signal by construction.
 *
 * TENANT ISOLATION: the tenant is taken from the authenticated token and the request body is
 * rejected if it tries to carry one. The engine never looks a candidate up - the caller supplies
 * the record it already holds - so this route cannot widen anyone's access. The tenant on the
 * response is therefore an attestation of who asked, not an authorisation decision this route made.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { buildKnowledgeGraph } from '../knowledge-graph/graph.js';
import {
  evaluateEvidence, validateAssessment, deriveContract,
  type CandidateProfileLike, type JobProfileLike,
} from '../evidence/engine.js';
import {
  EVIDENCE_ENGINE_VERSION, EVIDENCE_SCHEMA_VERSION, EVIDENCE_STATES, EVIDENCE_TYPES,
  EVIDENCE_RANK, NON_PROFESSIONAL_TYPES, NON_PRODUCTION_TYPES,
} from '../evidence/contract.js';
import {
  evidenceConflict, evidenceEvaluation, evidenceEvaluationFailure, evidenceEvaluationLatency,
  evidenceEvaluationSuccess, evidenceFalseAttributionGuard, evidenceGap, evidenceState,
  evidenceUnits, evidenceValidationFailure,
} from '../evidence/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

/** Shared with the graph route's rationale: immutable, deterministic, so built once. */
const graph = buildKnowledgeGraph();

/**
 * Bounds. A JD x candidate evaluation is O(requirements x skills), so both sides are capped
 * independently - a body under the 1 MB express limit could still carry 50,000 requirements and
 * turn a cheap evaluation into a CPU exhaustion primitive (§35).
 */
const MAX_REQUIREMENTS = 200;
const MAX_SKILLS = 500;
const MAX_PROJECTS = 200;
const MAX_TEXT_CHARS = 20_000;

/** Versions and the closed enums, so a consumer can pin exactly what it reasoned against. */
router.get('/evidence/meta', (_req, res) => {
  res.json({
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    evidence_engine_version: EVIDENCE_ENGINE_VERSION,
    states: EVIDENCE_STATES,
    evidence_types: EVIDENCE_TYPES,
    evidence_rank: EVIDENCE_RANK,
    non_professional_types: [...NON_PROFESSIONAL_TYPES],
    non_production_types: [...NON_PRODUCTION_TYPES],
    graph_fingerprint: graph.fingerprint(),
    produces_match_score: false,
  });
});

/**
 * The evidence contract for a JD alone - "what would prove these requirements" - with no candidate
 * involved. Useful to a consumer that wants to show a recruiter what the JD actually demands before
 * any candidate is on screen.
 */
router.post('/evidence/contract', (req, res) => {
  const job = (req.body as { job?: JobProfileLike })?.job;
  if (!job || typeof job !== 'object' || !Array.isArray(job.requirements)) {
    evidenceEvaluationFailure.inc({ reason: 'bad_request' });
    return res.status(400).json({ error: 'A job intelligence profile with requirements is required.' });
  }
  if (job.requirements.length > MAX_REQUIREMENTS) {
    evidenceEvaluationFailure.inc({ reason: 'too_large' });
    return res.status(400).json({ error: `At most ${MAX_REQUIREMENTS} requirements.` });
  }
  res.json({
    success: true,
    evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
    contracts: job.requirements.map((r) => deriveContract(r, job)),
  });
});

router.post('/evidence/evaluate', (req, res) => {
  evidenceEvaluation.inc();
  const started = process.hrtime.bigint();
  try {
    const body = req.body as { job?: JobProfileLike; candidate?: CandidateProfileLike; tenant_id?: unknown };

    // A caller may not name its own tenant. Accepting this field even to ignore it would leave a
    // reviewer unable to tell, from the wire format alone, whether it was ever honoured.
    if (body?.tenant_id !== undefined) {
      evidenceEvaluationFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'tenant_id is derived from the token and must not be supplied.' });
    }

    const { job, candidate } = body ?? {};
    if (!job || typeof job !== 'object' || !candidate || typeof candidate !== 'object') {
      evidenceEvaluationFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'Both job and candidate intelligence profiles are required.' });
    }
    if ((job.requirements?.length ?? 0) > MAX_REQUIREMENTS
      || (candidate.skills?.length ?? 0) > MAX_SKILLS
      || (candidate.projects?.length ?? 0) > MAX_PROJECTS) {
      evidenceEvaluationFailure.inc({ reason: 'too_large' });
      return res.status(400).json({
        error: `Limits: ${MAX_REQUIREMENTS} requirements, ${MAX_SKILLS} skills, ${MAX_PROJECTS} projects.`,
      });
    }
    // Free text arrives inside provenance from an untrusted resume; bound it per field rather than
    // trusting the aggregate body limit.
    for (const s of candidate.skills ?? []) {
      if ((s.provenance?.source_text?.length ?? 0) > MAX_TEXT_CHARS) {
        evidenceEvaluationFailure.inc({ reason: 'too_large' });
        return res.status(400).json({ error: `Evidence source text exceeds ${MAX_TEXT_CHARS} characters.` });
      }
    }

    const tenantId = `tenant-${req.user?.company_id ?? 'unknown'}`;
    const assessment = evaluateEvidence(job, candidate, graph, tenantId);

    // FAIL CLOSED (§41). An assessment that violates the evidence hierarchy is never returned.
    // Shipping it with a warning would put an unearned "professional experience" claim about a real
    // person in front of a recruiter, which is the precise harm this phase exists to prevent.
    const issues = validateAssessment(assessment);
    if (issues.length > 0) {
      for (const i of issues) {
        const guard = i.problem.includes('professional status') ? 'professional'
          : i.problem.includes('production status') ? 'production'
            : i.problem.includes('academic') ? 'academic_professional'
              : i.problem.includes('INFERRED') ? 'indirect_derivation' : null;
        if (guard) evidenceFalseAttributionGuard.inc({ guard });
      }
      evidenceValidationFailure.inc();
      evidenceEvaluationFailure.inc({ reason: 'validation' });
      // Ids only. Never resume text, never requirement text - both are untrusted and carry PII.
      logger.error({ job_id: job.job_id ?? null, candidate_id: candidate.candidate_id ?? null,
        issueCount: issues.length }, 'Evidence assessment failed validation');
      return res.status(422).json({ error: 'Evidence assessment failed validation', issues });
    }

    for (const a of assessment.assessments) {
      evidenceState.inc({ state: a.state });
      for (const g of a.gaps) evidenceGap.inc({ kind: g.kind });
      for (const u of a.evidence) evidenceUnits.inc({ evidence_type: u.evidence_type });
      for (const c of a.conflicts) evidenceConflict.inc({ severity: c.severity });
    }
    evidenceEvaluationSuccess.inc();
    evidenceEvaluationLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);

    res.json({ success: true, assessment });
  } catch (error: unknown) {
    evidenceEvaluationFailure.inc({ reason: 'internal_error' });
    logger.error({ err: error instanceof Error ? error.message : String(error) },
      'Evidence evaluation failed');
    res.status(500).json({ error: 'Evidence evaluation failed' });
  }
});

export default router;
