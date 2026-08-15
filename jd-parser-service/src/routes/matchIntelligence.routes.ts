/**
 * Phase 7 Semantic Matching & Reasoning API.
 *
 * SHADOW BY CONSTRUCTION (§5, §34). This route computes a Match Intelligence Profile from the two
 * profiles the caller supplies and returns it. It does not read, write or influence any production
 * match score, candidate ordering or recruiter recommendation - matching-scoring-service is
 * untouched and remains authoritative. Nothing in the repository consumes this endpoint.
 *
 * THE SCORE IS ALWAYS SHIPPED WITH ITS DECOMPOSITION. `overall_fit.score` alone is never returned;
 * a consumer that wants the number must also receive the components that produce it, so a recruiter
 * -facing surface cannot present an unexplained percentage.
 *
 * NOTHING THE CALLER SENDS IS TRUSTED AS AUTHORITATIVE (§39). Scores, evidence, confidences and
 * requirement states in the request body are ignored; every authoritative value is recomputed from
 * the validated Phase 3 / Phase 4 inputs through Phases 5 and 6.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { buildKnowledgeGraph } from '../knowledge-graph/graph.js';
import {
  buildMatchIntelligence, validateMatchProfile,
  type CandidateProfileP7, type JobProfileP7,
} from '../matching/engine.js';
import {
  COMPONENT_WEIGHT, LEVEL_WEIGHT, MATCH_ENGINE_VERSION, MATCH_SCHEMA_VERSION,
  SATISFACTION_CREDIT, SATISFACTION_STATES, SEMANTIC_ROUTES,
} from '../matching/contract.js';
import { EVIDENCE_ENGINE_VERSION } from '../evidence/contract.js';
import {
  semanticMatchAttempts, semanticMatchConflict, semanticMatchFailure, semanticMatchGap,
  semanticMatchInsufficient, semanticMatchLatency, semanticMatchRequirement, semanticMatchRoute,
  semanticMatchScore, semanticMatchSuccess, semanticMatchValidationFailure,
} from '../matching/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

const graph = buildKnowledgeGraph();

/** Bounds. Matching is O(requirements x skills), so both sides are capped independently. */
const MAX_REQUIREMENTS = 200;
const MAX_SKILLS = 500;
const MAX_PROJECTS = 200;
const MAX_EXPERIENCE = 100;

/** Versions, the closed enums and the scoring policy, so a consumer can pin what it reasoned against. */
router.get('/match/meta', (_req, res) => {
  res.json({
    match_schema_version: MATCH_SCHEMA_VERSION,
    match_engine_version: MATCH_ENGINE_VERSION,
    evidence_engine_version: EVIDENCE_ENGINE_VERSION,
    satisfaction_states: SATISFACTION_STATES,
    semantic_routes: SEMANTIC_ROUTES,
    level_weight: LEVEL_WEIGHT,
    satisfaction_credit: SATISFACTION_CREDIT,
    component_weight: COMPONENT_WEIGHT,
    graph_fingerprint: graph.fingerprint(),
    /** Explicit contract statement: this engine is shadow-only and authoritative for nothing. */
    shadow_only: true,
    affects_production_ranking: false,
    score_always_decomposed: true,
  });
});

router.post('/match/evaluate', (req, res) => {
  semanticMatchAttempts.inc();
  const started = process.hrtime.bigint();
  try {
    const body = req.body as {
      job?: JobProfileP7; candidate?: CandidateProfileP7; tenant_id?: unknown;
      overall_fit?: unknown; score?: unknown;
    };

    // A caller may name neither its tenant nor its score. Accepting either field even to ignore it
    // would leave a reviewer unable to tell from the wire format whether it was ever honoured.
    if (body?.tenant_id !== undefined || body?.overall_fit !== undefined || body?.score !== undefined) {
      semanticMatchFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({
        error: 'tenant_id, score and overall_fit are derived by the engine and must not be supplied.',
      });
    }

    const { job, candidate } = body ?? {};
    if (!job || typeof job !== 'object' || !candidate || typeof candidate !== 'object') {
      semanticMatchFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'Both job and candidate intelligence profiles are required.' });
    }
    if ((job.requirements?.length ?? 0) > MAX_REQUIREMENTS
      || (candidate.skills?.length ?? 0) > MAX_SKILLS
      || (candidate.projects?.length ?? 0) > MAX_PROJECTS
      || (candidate.experience?.length ?? 0) > MAX_EXPERIENCE) {
      semanticMatchFailure.inc({ reason: 'too_large' });
      return res.status(400).json({
        error: `Limits: ${MAX_REQUIREMENTS} requirements, ${MAX_SKILLS} skills, `
          + `${MAX_PROJECTS} projects, ${MAX_EXPERIENCE} experience entries.`,
      });
    }

    const tenantId = `tenant-${req.user?.company_id ?? 'unknown'}`;
    const profile = buildMatchIntelligence(job, candidate, graph, tenantId);

    // FAIL CLOSED. A profile whose score does not reconstruct from its components, or which credits
    // a requirement beyond its route or its Phase 6 evidence, is never returned.
    const issues = validateMatchProfile(profile);
    if (issues.length > 0) {
      semanticMatchValidationFailure.inc();
      semanticMatchFailure.inc({ reason: 'validation' });
      logger.error({ job_id: job.job_id ?? null, candidate_id: candidate.candidate_id ?? null,
        issueCount: issues.length }, 'Match intelligence profile failed validation');
      return res.status(422).json({ error: 'Match profile failed validation', issues });
    }

    for (const r of profile.requirement_results) {
      semanticMatchRequirement.inc({ state: r.state });
      semanticMatchRoute.inc({ route: r.route });
      for (const g of r.gaps) semanticMatchGap.inc({ kind: g.kind });
    }
    for (const c of profile.contradictions) semanticMatchConflict.inc({ kind: c.kind });
    semanticMatchScore.observe(profile.overall_fit.score);
    if (profile.overall_fit.insufficient_data) semanticMatchInsufficient.inc();
    semanticMatchSuccess.inc();
    semanticMatchLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);

    res.json({ success: true, shadow_only: true, profile });
  } catch (error: unknown) {
    semanticMatchFailure.inc({ reason: 'internal_error' });
    logger.error({ err: error instanceof Error ? error.message : String(error) },
      'Match intelligence evaluation failed');
    res.status(500).json({ error: 'Match intelligence evaluation failed' });
  }
});

export default router;
