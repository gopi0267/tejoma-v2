/**
 * Phase 3 JD Understanding Engine endpoint.
 *
 * Additive. It does not touch POST /jobs/parse-description, which keeps serving the existing
 * extraction contract byte-for-byte - so a failure here degrades nothing that exists today. It also
 * writes nothing: the profile is computed and returned, never persisted and never fed into ranking.
 * Phase 3's remit ends at producing the JD-side intelligence; Phase 4 is what consumes it.
 *
 * Auth mirrors the parser route exactly (recruiter/admin), so tenant boundaries and role checks are
 * the ones already enforced for JD content rather than a new path around them.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import {
  buildJobIntelligence, validateProfile, MAX_JD_CHARS, type JobRecordInput,
} from '../jd-understanding/engine.js';
import {
  jdAmbiguityTotal, jdContradictionTotal, jdInferenceRejected, jdRequirementCount,
  jdUnderstandingAttempts, jdUnderstandingFailure, jdUnderstandingLatency,
  jdUnderstandingSuccess, jdValidationFailure,
} from '../jd-understanding/metrics.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.post('/jobs/understand', async (req, res) => {
  jdUnderstandingAttempts.inc();
  const started = process.hrtime.bigint();
  try {
    const job = req.body as { job?: JobRecordInput } | JobRecordInput;
    const record: JobRecordInput = (job as { job?: JobRecordInput }).job ?? (job as JobRecordInput);

    if (!record || typeof record !== 'object') {
      jdUnderstandingFailure.inc({ reason: 'bad_request' });
      return res.status(400).json({ error: 'A job record is required.' });
    }
    // Bound every free-text field independently rather than the serialized body, so one oversized
    // field cannot be smuggled in under a small total.
    for (const f of ['description', 'job_summary', 'title'] as const) {
      const v = (record as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.length > MAX_JD_CHARS) {
        jdUnderstandingFailure.inc({ reason: 'input_too_large' });
        return res.status(400).json({ error: `Field ${f} exceeds ${MAX_JD_CHARS} characters.` });
      }
    }

    const profile = buildJobIntelligence(record);

    // FAIL CLOSED. A profile that cannot substantiate its own citations is not returned at all -
    // returning it with a warning would let an unverifiable claim reach Phase 4 wearing provenance.
    const issues = validateProfile(profile, record);
    if (issues.length > 0) {
      for (const i of issues.slice(0, 10)) jdValidationFailure.inc({ problem: i.problem.slice(0, 40) });
      jdInferenceRejected.inc({ stage: 'validation' }, issues.length);
      jdUnderstandingFailure.inc({ reason: 'validation_failed' });
      logger.error({ job_id: record.id ?? null, issueCount: issues.length, issues: issues.slice(0, 10) },
        'JD intelligence profile failed validation');
      return res.status(422).json({ error: 'Profile failed validation', issues });
    }

    jdRequirementCount.observe(profile.requirements.length);
    for (const a of profile.ambiguities) jdAmbiguityTotal.inc({ type: a.type });
    for (const c of profile.contradictions) jdContradictionTotal.inc({ type: c.type });
    jdUnderstandingSuccess.inc();
    jdUnderstandingLatency.observe(Number(process.hrtime.bigint() - started) / 1e9);

    res.json({ success: true, profile });
  } catch (error: unknown) {
    jdUnderstandingFailure.inc({ reason: 'internal_error' });
    // The raw message is logged, never returned and never used as a metric label - a JD is
    // untrusted input and its text must not become an unbounded label or a response body.
    logger.error({ err: error instanceof Error ? error.message : String(error) },
      'JD understanding failed');
    res.status(500).json({ error: 'JD understanding failed' });
  }
});

export default router;
