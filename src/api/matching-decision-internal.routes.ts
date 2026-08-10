/**
 * Internal API for matching-decision-service's proxy routes (Remaining-monolith migration,
 * Step 6) - network-boundary trusted (no JWT), matching every other Tier 0 service's
 * /internal/* convention.
 *
 * POST /swipes (the old proxy-target for recordSwipeWithSideEffects) and POST .../notes,
 * POST .../detailed-score, PATCH .../decision (the old proxy targets for
 * upsertRecruiterNoteForSwipe/generateAndSaveDetailedScore/changeRecruiterReviewDecision) are all
 * gone now - every one of those writes is a real cutover (write-cutover completion plan, Phases C
 * and D): matching-decision-service performs its own write and calls one of the mirror-and-notify
 * endpoints below instead, the same reverse-mirror shape as job-internal.routes.ts's/
 * candidate-core-internal.routes.ts's own mirror-and-notify endpoints (Phases A/B). The three
 * underlying functions (upsertRecruiterNoteForSwipe/generateAndSaveDetailedScore/
 * changeRecruiterReviewDecision) are NOT dead - recruiter-review.routes.ts's own direct
 * /api/recruiter-review/* routes still use them, just unreachable via the real user-facing nginx
 * path now that the gateway routes that traffic to matching-decision-service instead.
 *
 * Only GET /recruiter-review (list) and GET /recruiter-review/:candidateId/:jobId (detail) still
 * proxy - a cross-database SQL JOIN that can no longer be expressed once its tables live in
 * separate databases (list), and computeMatchExplanation, still fully unextracted per
 * MIGRATION_RUNBOOK.md §7 (detail).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { publishRealtimeEvent } from '../realtimeBroadcast.js';
import { enqueueRetrain } from '../queue/retrainQueue.js';
import { logger } from '../utils/logger.js';
import { logShadowScoresInBackground } from '../matchingEvaluationServiceShadow.js';
import {
  getRecruiterReviewListWithStats,
  getRecruiterReviewDetailWithExplanation,
} from './recruiter-review.routes.js';

const router = Router();

// Write-cutover completion plan, Phase C (extended in Phase D for source: 'decision-change') -
// matching-decision-service now performs the real INSERT itself (own database, own id sequence)
// for BOTH POST /swipes and PATCH /recruiter-review/:id/decision (a decision change IS a new
// swipe row - db.recordSwipe is the shared write for both, per the monolith's own
// changeRecruiterReviewDecision); this endpoint is the reverse of the old proxy targets: mirror
// the already-written row into this table (db.ts's mirrorUpsertSwipe, explicit id, never
// re-running this table's own sequence) and re-fire the exact same side effects db.recordSwipe/
// recordSwipeWithSideEffects/changeRecruiterReviewDecision always fired for a new swipe. The
// mirror-upsert itself is awaited (the caller needs it durable before its own response returns)
// but every side effect below stays exactly as fire-and-forget as it always was.
//
// `source: 'decision-change'` selects changeRecruiterReviewDecision's own narrower hook bundle:
// db.recordSwipe's own two hooks (mutual-match check, syncApplicationStatusFromRecruiterDecision)
// and shadow logging fire either way (both flows called them), but decision-change broadcasts
// 'recruiter-review-decision-changed' instead of 'swipe-completed' and does NOT enqueue a
// retrain - changeRecruiterReviewDecision never called enqueueRetrain, only
// recordSwipeWithSideEffects (POST /swipes's own flow) did.
router.post('/swipes/mirror-and-notify', async (req, res) => {
  try {
    const { swipe, source } = req.body as { swipe: Record<string, unknown>; source?: 'decision-change' };
    if (!swipe || typeof swipe.id !== 'number') {
      return res.status(400).json({ error: 'swipe (with a real id) is required' });
    }
    await db.mirrorUpsertSwipe(swipe);

    const companyId = Number(swipe.company_id);
    const candidateId = Number(swipe.candidate_id);
    const jobId = Number(swipe.job_id);
    const action = Number(swipe.action);

    // Phase 3 (recordSwipe's own hook, replicated here): fire-and-forget mutual-match check -
    // never awaited, resolves instantly for every ordinary recruiter-uploaded candidate.
    if (action === 1) {
      db.getLinkedCandidateAccountId(candidateId)
        .then((candidateAccountId) => {
          if (candidateAccountId) return db.evaluateAndCreateMutualMatch(candidateAccountId, jobId);
        })
        .catch((err) => logger.warn({ err: err.message, candidateId, jobId }, 'Error in post-swipe-mirror match check'));
    }

    // Phase 5 (recordSwipe's own hook, replicated here): fire-and-forget application-status
    // sync - runs for every action (0/0.5/1).
    db.syncApplicationStatusFromRecruiterDecision(candidateId, jobId, companyId, action).catch((err) =>
      logger.warn({ err: err.message, candidateId, jobId }, 'Error in post-swipe-mirror application status sync')
    );

    // recordSwipeWithSideEffects's/changeRecruiterReviewDecision's own hooks, replicated here -
    // shadow proficiency logging needs the full candidate/job rows, which this table doesn't
    // carry inline.
    const [candidate, job] = await Promise.all([db.getCandidateById(candidateId, companyId), db.getJobById(jobId, companyId)]);
    if (candidate && job) {
      const breakdown = swipe.breakdown as { skills?: { matched?: string[] } } | null | undefined;
      logShadowScoresInBackground(companyId, candidate, job, breakdown?.skills?.matched ?? [], Number(swipe.match_score), action);
      if (source === 'decision-change') {
        await publishRealtimeEvent('recruiter-review-decision-changed', { candidate_id: candidateId, job_id: jobId, action });
      } else {
        await publishRealtimeEvent('swipe-completed', {
          recruiter_id: swipe.recruiter_id,
          job_id: jobId,
          candidate_id: candidateId,
          candidateName: candidate.name,
          action: action === 1 ? 'accept' : 'reject',
        });
      }
    }

    if (source !== 'decision-change') {
      enqueueRetrain().catch((err) => logger.warn({ err: err.message }, 'Failed to enqueue background retrain after swipe mirror'));
    }

    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/matching-decision] swipe mirror-and-notify error:', error);
    res.status(500).json({ error: 'Failed to mirror swipe: ' + error.message });
  }
});

// Write-cutover completion plan, Phase D - reverse mirror for `recruiter_notes`. No hook bundle -
// the monolith's own upsertRecruiterNoteForSwipe never had background side effects beyond the
// write itself.
router.post('/recruiter-review/notes/mirror-and-notify', async (req, res) => {
  try {
    const { note } = req.body as { note: Record<string, unknown> };
    if (!note || typeof note.id !== 'number') {
      return res.status(400).json({ error: 'note (with a real id) is required' });
    }
    await db.mirrorUpsertRecruiterNote(note);
    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/matching-decision] recruiter-note mirror-and-notify error:', error);
    res.status(500).json({ error: 'Failed to mirror recruiter note: ' + error.message });
  }
});

// Write-cutover completion plan, Phase D - reverse mirror for `detailed_scoring_reports`. No hook
// bundle either - generateAndSaveDetailedScore's only side effect was the Gemini call itself,
// already made (by matching-decision-service, before this endpoint is ever reached).
router.post('/recruiter-review/detailed-score/mirror-and-notify', async (req, res) => {
  try {
    const { report } = req.body as { report: Record<string, unknown> };
    if (!report || typeof report.id !== 'number') {
      return res.status(400).json({ error: 'report (with a real id) is required' });
    }
    await db.mirrorUpsertDetailedScoringReport(report);
    res.status(200).json({ mirrored: true });
  } catch (error: any) {
    console.error('[internal/matching-decision] detailed-score mirror-and-notify error:', error);
    res.status(500).json({ error: 'Failed to mirror detailed scoring report: ' + error.message });
  }
});

router.get('/recruiter-review', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
    // Query params, not body - matches every other internal GET endpoint's convention. Values
    // arrive pre-validated (Zod-parsed) from matching-decision-service's own public route, which
    // forwards its own already-typed filter object as a query string; this endpoint trusts the
    // shape as-is, matching every other internal proxy's contract.
    const q = req.query as Record<string, string | undefined>;
    const filters = {
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 25,
      search: q.search,
      jobId: q.jobId !== undefined ? Number(q.jobId) : undefined,
      decision: q.decision as 'accepted' | 'rejected' | 'saved' | undefined,
      recruiterId: q.recruiterId !== undefined ? Number(q.recruiterId) : undefined,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      minExperience: q.minExperience !== undefined ? Number(q.minExperience) : undefined,
      maxExperience: q.maxExperience !== undefined ? Number(q.maxExperience) : undefined,
      skills: q.skills,
      minScore: q.minScore !== undefined ? Number(q.minScore) : undefined,
      maxScore: q.maxScore !== undefined ? Number(q.maxScore) : undefined,
      sortBy: q.sortBy as any,
    };
    res.json(await getRecruiterReviewListWithStats(companyId, filters));
  } catch (error: any) {
    console.error('[internal/matching-decision] recruiter-review list error:', error);
    res.status(500).json({ error: 'Failed to load recruiter review list: ' + error.message });
  }
});

router.get('/recruiter-review/:candidateId/:jobId', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    const candidateId = parseInt(req.params.candidateId, 10);
    const jobId = parseInt(req.params.jobId, 10);
    if (!Number.isFinite(companyId) || Number.isNaN(candidateId) || Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'a valid companyId, candidateId, and jobId are required' });
    }
    const result = await getRecruiterReviewDetailWithExplanation(candidateId, jobId, companyId);
    if (!result) return res.status(404).json({ error: 'Candidate or job not found' });
    res.json(result);
  } catch (error: any) {
    console.error('[internal/matching-decision] recruiter-review detail error:', error);
    res.status(500).json({ error: 'Failed to load recruiter review detail: ' + error.message });
  }
});

// Remaining-monolith migration, Item 3 - recruiter-review detail's explainability reads.
// matching-decision-service's ported explainability module calls these to get career_trajectories
// and reasoning_conclusions (the monolith's own locally-computed enrichment tables, not shadow
// services). Thin pass-throughs of the existing unmodified db.getCareerTrajectory/
// db.getReasoningConclusions - no new computation, no schema change.
router.get('/career-trajectory', async (req, res) => {
  try {
    const candidateId = parseInt(req.query.candidateId as string, 10);
    const companyId = Number(req.query.companyId);
    if (Number.isNaN(candidateId) || !Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'candidateId and companyId are required' });
    }
    const trajectory = await db.getCareerTrajectory(candidateId);
    res.json({ trajectory });
  } catch (error: any) {
    console.error('[internal/matching-decision] career-trajectory error:', error);
    res.status(500).json({ error: 'Failed to load career trajectory: ' + error.message });
  }
});

router.get('/reasoning-conclusions', async (req, res) => {
  try {
    const subjectType = req.query.subjectType as string;
    const subjectId = parseInt(req.query.subjectId as string, 10);
    if (!['candidate', 'job', 'swipe'].includes(subjectType) || Number.isNaN(subjectId)) {
      return res.status(400).json({ error: 'subjectType and subjectId are required' });
    }
    const conclusions = await db.getReasoningConclusions(subjectType, subjectId);
    res.json({ conclusions });
  } catch (error: any) {
    console.error('[internal/matching-decision] reasoning-conclusions error:', error);
    res.status(500).json({ error: 'Failed to load reasoning conclusions: ' + error.message });
  }
});

export default router;
