/**
 * Phase 4 Candidate Understanding Engine endpoint.
 *
 * Additive and stateless. It reads nothing from a database, writes nothing, and is not on any
 * existing candidate path - the resume parser and candidate workflows are untouched, so a fault
 * here degrades nothing that exists today. Nothing consumes the profile for ranking; Phase 5+ are
 * the intended consumers.
 *
 * TENANT ISOLATION: the engine never queries for a candidate. The caller supplies the record it is
 * already authorised to hold, so this route cannot widen anyone's access - there is no candidate id
 * lookup for a caller to tamper with. Auth mirrors the other routes (recruiter/admin, RS256).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import {
  buildCandidateIntelligence, validateCandidateProfile, MAX_RESUME_CHARS,
  type CandidateRecordInput,
} from '../candidate-understanding/engine.js';
import {
  candidateAmbiguityTotal, candidateContradictionTotal, candidateEvidenceUnits,
  candidateInferenceRejected, candidateSkillUnits, candidateUnderstandingAttempts,
  candidateUnderstandingFailure, candidateUnderstandingLatency, candidateUnderstandingSuccess,
  candidateValidationFailure,
} from '../candidate-understanding/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.post('/candidates/understand', async (req, res) => {
  candidateUnderstandingAttempts.inc();
  const started = process.hrtime.bigint();
  try {
    const body = req.body as { candidate?: CandidateRecordInput } | CandidateRecordInput;
    const record: CandidateRecordInput =
      (body as { candidate?: CandidateRecordInput }).candidate ?? (body as CandidateRecordInput);

    if (!record || typeof record !== 'object') {
      candidateUnderstandingFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'A candidate record is required.' });
    }
    // Bound each free-text field independently: one oversized field must not slip through under a
    // small total body size.
    for (const f of ['resume_text', 'resume_summary', 'projects'] as const) {
      const v = (record as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.length > MAX_RESUME_CHARS) {
        candidateUnderstandingFailure.inc({ reason: 'input_too_large' });
        return res.status(400).json({ error: `Field ${f} exceeds ${MAX_RESUME_CHARS} characters.` });
      }
    }

    const profile = buildCandidateIntelligence(record);

    // FAIL CLOSED. A profile that cannot substantiate its own citations is never returned -
    // shipping it with a warning would let an unverifiable claim about a real person reach a
    // downstream consumer wearing provenance.
    const issues = validateCandidateProfile(profile, record);
    if (issues.length > 0) {
      for (const i of issues.slice(0, 10)) candidateValidationFailure.inc({ problem: i.problem.slice(0, 40) });
      candidateInferenceRejected.inc({ stage: 'validation' }, issues.length);
      candidateUnderstandingFailure.inc({ reason: 'validation_failed' });
      // candidate_id only; never resume text, and never the raw record.
      logger.error({ candidate_id: record.id ?? null, issueCount: issues.length },
        'Candidate intelligence profile failed validation');
      return res.status(422).json({ error: 'Profile failed validation', issues });
    }

    for (const s of profile.skills) {
      candidateSkillUnits.inc({ assertion: s.assertion });
      candidateEvidenceUnits.inc({ strength: s.evidence_strength });
    }
    for (const a of profile.ambiguities) candidateAmbiguityTotal.inc({ type: a.type });
    for (const c of profile.contradictions) candidateContradictionTotal.inc({ type: c.type });
    candidateUnderstandingSuccess.inc();
    candidateUnderstandingLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);

    res.json({ success: true, profile });
  } catch (error: unknown) {
    candidateUnderstandingFailure.inc({ reason: 'internal_error' });
    // Resume content is untrusted and contains PII; the message is logged, never returned to the
    // caller and never used as a metric label.
    logger.error({ err: error instanceof Error ? error.message : String(error) },
      'Candidate understanding failed');
    res.status(500).json({ error: 'Candidate understanding failed' });
  }
});

export default router;
