/**
 * Real, gateway-routed cutovers for the AI Match queue/score/history/stats surface
 * (Remaining-monolith migration, Step 6; POST /swipes cut over in the write-cutover completion
 * plan, Phase C). GET /matches/queue/:job_id, POST /matches/score, POST /swipes, GET
 * /swipes/history, and GET /swipes/stats are all genuine cutovers: this service's own `swipes`
 * table (now the write-authority, not just a dual-written mirror - see db.ts's recordSwipe and
 * migrations/002_resync_sequences.up.sql), plus real fan-out to job-service (jobs), candidate-
 * core-service (candidates), and matching-scoring-service (tier: 'full' ranking/scoring).
 *
 * POST /swipes performs the real INSERT locally, then awaits (but never fails on)
 * monolithClient.mirrorAndNotifySwipe - real-time broadcast (src/realtime.ts), the BullMQ retrain
 * queue, shadow-mode proficiency-weighting logging, the mutual-match check, and
 * syncApplicationStatusFromRecruiterDecision all still only exist on the monolith side, so they
 * re-fire there against the mirrored row rather than being ported here.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import * as jobServiceClient from '../services/jobServiceClient.js';
import * as candidateCoreServiceClient from '../services/candidateCoreServiceClient.js';
import * as matchingScoringServiceClient from '../services/matchingScoringServiceClient.js';
import * as monolithClient from '../services/monolithClient.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/matches/queue/:job_id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const job_id = parseInt(req.params.job_id, 10);
    if (Number.isNaN(job_id)) return res.status(400).json({ error: 'Invalid Job ID parameter' });

    const job = await jobServiceClient.getJobById(job_id, companyId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Shortlist-only queue: only candidates whose latest decision for this job is still
    // "Saved" (action=0.5) - i.e. not yet finalized to Accepted/Rejected. Purely local (own
    // swipes mirror), no cross-service call needed.
    const shortlistedIds = await db.getShortlistedCandidateIds(job_id, companyId);
    const queueCandidates = await candidateCoreServiceClient.getCandidatesByIds([...shortlistedIds], companyId);

    if (queueCandidates.length === 0) {
      return res.json({ candidate: null, remaining: 0 });
    }

    const ranked = await matchingScoringServiceClient.rankCandidatesForJob(job, queueCandidates, {
      skipGeminiSummary: true,
      persist: { companyId, source: 'swipe_queue' },
    });
    const scoredCandidates = ranked.map(({ candidate, match_score, score }) => ({
      candidate, match_score, breakdown: score!.breakdown, summary: score!.summary,
    }));

    // BGE shadow retrieval comparison is deliberately NOT replicated here - shadow-only,
    // fire-and-forget telemetry with zero effect on real output; porting a client for it is out
    // of scope for this step (MIGRATION_RUNBOOK.md §6aa-equivalent note for this step).
    const topCandidate = scoredCandidates[0];
    res.json({
      candidate: topCandidate.candidate,
      match_score: topCandidate.match_score,
      breakdown: topCandidate.breakdown,
      summary: topCandidate.summary,
      remaining: scoredCandidates.length,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, jobId: req.params.job_id }, 'Failed to load match queue candidate');
    res.status(502).json({ error: 'Upstream match queue data is currently unavailable. Please try again.' });
  }
});

router.post('/matches/score', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const { job_id, candidate_id } = req.body;
    const parsedJobId = parseInt(job_id, 10);
    const parsedCandId = parseInt(candidate_id, 10);
    if (Number.isNaN(parsedJobId) || Number.isNaN(parsedCandId)) {
      return res.status(400).json({ error: 'Invalid Job ID or Candidate ID' });
    }

    const [job, candidate] = await Promise.all([
      jobServiceClient.getJobById(parsedJobId, companyId),
      candidateCoreServiceClient.getCandidateById(parsedCandId, companyId),
    ]);
    if (!job || !candidate) return res.status(404).json({ error: 'Job or Candidate not found' });

    const scoreData = await matchingScoringServiceClient.scoreCandidateForJob(job, candidate);
    res.json({
      feature_score: scoreData.feature_score,
      embedding_score: scoreData.embedding_score,
      ml_score: scoreData.ml_score,
      final_score: scoreData.final_score,
      breakdown: scoreData.breakdown,
      summary: scoreData.summary,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to compute match score');
    res.status(502).json({ error: 'Upstream scoring data is currently unavailable. Please try again.' });
  }
});

router.post('/swipes', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    // recruiter_id is derived from the authenticated session, never trusted from the client -
    // otherwise any signed-in user could record swipes attributed to a different recruiter.
    const recruiter_id = req.user!.user_id;
    const { job_id, candidate_id, action, decision_time_seconds } = req.body as {
      job_id: any; candidate_id: any; action: any; decision_time_seconds?: any;
    };
    if (!job_id || !candidate_id || action === undefined) {
      return res.status(400).json({ error: 'Missing required swipe payload properties' });
    }
    const parsedJobId = parseInt(job_id, 10);
    const parsedCandId = parseInt(candidate_id, 10);

    const [job, candidate] = await Promise.all([
      jobServiceClient.getJobById(parsedJobId, companyId),
      candidateCoreServiceClient.getCandidateById(parsedCandId, companyId),
    ]);
    if (!job || !candidate) return res.status(404).json({ error: 'Job or Candidate not found' });

    const scoreData = await matchingScoringServiceClient.scoreCandidateForJob(job, candidate);

    const savedSwipe = await db.recordSwipe({
      company_id: companyId,
      recruiter_id,
      candidate_id: parsedCandId,
      job_id: parsedJobId,
      action: Number(action),
      match_score: scoreData.final_score,
      used_for_training: false,
      // Captured at decision time (see migration-recruiter-review.sql) so Recruiter Review's
      // score breakdown doesn't drift as the ML ensemble retrains after this swipe.
      breakdown: scoreData.breakdown,
      decision_time_seconds: typeof decision_time_seconds === 'number' && isFinite(decision_time_seconds) ? decision_time_seconds : null,
    });
    if (!savedSwipe) {
      return res.status(500).json({ error: 'Failed to save swipe decision. Please try again.' });
    }

    // Mirrors dualWrite.ts's own safety bar in the opposite direction - awaited so the
    // monolith's own copy (and every hook that re-fires from it) is normally consistent by the
    // time this response returns, but never allowed to turn into a user-facing failure since
    // this service's own write already succeeded above.
    await monolithClient.mirrorAndNotifySwipe(savedSwipe);

    // Item 4: Analytics CQRS - push activity to analytics service (fire-and-forget)
    fetch(`${process.env.ANALYTICS_SERVICE_URL || 'http://localhost:4010'}/internal/analytics/recent-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        activity: {
          swipeId: savedSwipe.id,
          recruiterName: req.user!.name,
          candidateName: candidate.name,
          jobTitle: job.title,
          action: action === 1 ? 'accept' : action === 0.5 ? 'save' : 'reject',
          matchScore: scoreData.final_score,
          timestamp: new Date().toISOString(),
        },
      }),
    }).catch((err) => logger.warn({ err }, 'Failed to push swipe to analytics'));

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter_review_view row (fire-and-forget).
    // This row will be queried by the list endpoint when RECRUITER_REVIEW_LIST_CUTOVER_ENABLED is true.
    db.upsertRecruiterReviewViewRow({
      candidate_id: parsedCandId,
      job_id: parsedJobId,
      company_id: companyId,
      candidate_name: candidate.name,
      candidate_email: candidate.email,
      candidate_phone: candidate.phone,
      candidate_skills: candidate.skills?.join(', '),
      candidate_location: candidate.current_location,
      candidate_years_exp: candidate.years_of_experience,
      candidate_company: candidate.current_company,
      job_title: job.title,
      job_location: job.location,
      job_company_name: job.company_name,
      recruiter_id: recruiter_id,
      latest_action: Number(action),
      latest_decision_date: new Date(),
      match_score: scoreData.final_score,
    });

    // GET NEXT CANDIDATE - next still-shortlisted-and-pending candidate for this job (the swipe
    // just recorded above already moved `candidate` off the shortlist if it was a final
    // Accept/Reject, since getShortlistedCandidateIds only reads the latest row per pair).
    const shortlistedIds = await db.getShortlistedCandidateIds(job.id, companyId);
    const queueCandidates = await candidateCoreServiceClient.getCandidatesByIds([...shortlistedIds], companyId);

    let next_candidate = null;
    if (queueCandidates.length > 0) {
      const ranked = await matchingScoringServiceClient.rankCandidatesForJob(job, queueCandidates, {
        skipGeminiSummary: true,
        persist: { companyId },
      });
      const top = ranked[0];
      next_candidate = {
        candidate: top.candidate,
        match_score: top.match_score,
        breakdown: top.score!.breakdown,
        summary: top.score!.summary,
        remaining: ranked.length,
      };
    }

    res.status(201).json({ success: true, match_score: scoreData.final_score, next_candidate });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to process swipe');
    res.status(500).json({ error: 'Failed to process swipe' });
  }
});

router.get('/swipes/history', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const swipes = await db.getSwipes(companyId);

    const jobIds = [...new Set(swipes.map((s) => s.job_id))];
    const candidateIds = [...new Set(swipes.map((s) => s.candidate_id))];
    const [jobs, candidates] = await Promise.all([
      jobServiceClient.getJobsByIds(jobIds, companyId),
      candidateCoreServiceClient.getCandidatesByIds(candidateIds, companyId),
    ]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    const history = swipes.map((s) => ({
      ...s,
      candidate_name: candidateById.get(s.candidate_id)?.name ?? 'Unknown Candidate',
      job_title: jobById.get(s.job_id)?.title ?? 'Unknown Job',
    }));

    // db.getSwipes (both this service's own and the monolith's) orders by timestamp DESC
    // (most recent first); the monolith's own handler then reverses in JS, so the final response
    // is oldest-first - replicated here for exact behavioral parity.
    res.json(history.reverse());
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load swipe history');
    res.status(502).json({ error: 'Upstream swipe history data is currently unavailable. Please try again.' });
  }
});

router.get('/swipes/stats', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    // Defaults to the caller's own stats rather than a hardcoded id; an explicit recruiter_id
    // (e.g. to view a teammate's stats) is still allowed but scoped to the caller's own company.
    const recruiter_id = parseInt(req.query.recruiter_id as string, 10) || req.user!.user_id;
    res.json(await db.getSwipeStats(companyId, recruiter_id));
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load swipe stats');
    res.status(502).json({ error: 'Upstream swipe stats data is currently unavailable. Please try again.' });
  }
});

export default router;
