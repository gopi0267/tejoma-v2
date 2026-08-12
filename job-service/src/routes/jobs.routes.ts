/**
 * Public, gateway-routed job CRUD - ported from the monolith's src/api/job.routes.ts.
 *
 * GET /jobs/:id is the flagship real cutover from Step 4: a genuine, independent, multi-service
 * orchestration - own DB read fused with candidate-core-service's real candidate pool and
 * matching-scoring-service's real ranking. No monolith call anywhere in this handler.
 *
 * POST/PUT/DELETE are now ALSO a real cutover (write-cutover completion plan, Phase B): this
 * service performs the real INSERT/UPDATE/DELETE against its own database, then awaits (but
 * never fails the response on) a call to the monolith's new mirror-and-notify/mirror-delete
 * endpoints, which upsert/delete the row in the monolith's own `jobs` table by explicit id and
 * re-fire the exact same background side effects (RAG/embedding indexing, unknown-skill
 * discovery, reasoning) createJobWithSideEffects/updateJobWithSideEffects/deleteJob always fired.
 * The monolith's own copy has to stay fresh because recruiter-review.routes.ts's list/detail
 * views (staying monolith-local - a deliberate scope boundary, not a gap) read `jobs` directly.
 *
 * GET /jobs (list) is now a real cutover (remaining-monolith migration, Item 1): orchestrates
 * job-service's own job listing, candidate-core-service's total candidate count, and
 * matching-decision-service's per-job swipe counts, fused into the same response shape the
 * monolith's getEnrichedJobsList used to return. Same production pattern as GET /jobs/:id above.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import * as monolithClient from '../services/monolithClient.js';
import { getCandidatesForJobScoring, getCandidateCount } from '../services/candidateCoreServiceClient.js';
import { rankCandidatesForJob } from '../services/matchingScoringServiceClient.js';
import { getSwipeCountsByJob, refreshRecruiterReviewViewForJobs } from '../services/matchingDecisionServiceClient.js';
import { jobPayloadFromBody, jobUpdatePayloadFromBody } from '../services/jobPayload.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

function respondToProxyError(res: import('express').Response, error: unknown, fallbackMessage: string) {
  if (error instanceof monolithClient.MonolithProxyError) {
    if (error.status === 404) return res.status(404).json(error.body);
    if (error.status === 400) return res.status(400).json(error.body);
  } else {
    logger.error({ err: (error as Error).message }, fallbackMessage);
  }
  res.status(502).json({ error: 'Upstream job data is currently unavailable. Please try again.' });
}

// Remaining-monolith migration, Item 1 - GET /api/jobs (list) fan-out. Local orchestration
// replaces the monolith's getEnrichedJobsList: same 3-call fanout pattern as GET /jobs/:id.
export async function getEnrichedJobsList(companyId: number) {
  const [jobs, swipeCounts, totalCandidates] = await Promise.all([
    db.getJobs(companyId),
    getSwipeCountsByJob(companyId),
    getCandidateCount(companyId),
  ]);

  return {
    jobs: jobs.map(j => {
      const counts = swipeCounts.get(j.id) ?? { total: 0, accepted: 0, rejected: 0, pending: 0 };
      // Map matching-decision-service response to job enrichment fields
      const reviewed = counts.total || 0;
      const accepted = counts.accepted || 0;
      return {
        ...j,
        total_candidates: totalCandidates,
        reviewed,
        accepted,
        rejected: counts.rejected || 0,
        saved: counts.pending || 0, // pending swipes are "saved" for later
        acceptance_rate: reviewed > 0 ? Number(((accepted / reviewed) * 100).toFixed(1)) : 0,
      };
    }),
  };
}

router.get('/jobs', async (req, res) => {
  try {
    const result = await getEnrichedJobsList(req.user!.company_id);
    res.json(result.jobs);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load jobs');
    res.status(502).json({ error: 'Job data is currently unavailable. Please try again.' });
  }
});

router.post('/jobs', async (req, res) => {
  try {
    const payload = jobPayloadFromBody(req.user!.company_id, req.body);
    if (payload === 'invalid') {
      return res.status(400).json({ error: 'Missing required job creation parameters' });
    }
    const created = await db.createJob(payload);
    if (!created) {
      return res.status(500).json({ error: 'Failed to create job' });
    }

    // Item 7: Index locally before mirroring
    const { indexJobInBackground } = await import('../rag.service.js');
    indexJobInBackground(created);

    await monolithClient.mirrorAndNotifyJobCreate(created);

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    refreshRecruiterReviewViewForJobs([created.id]);

    res.status(201).json(created);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to create job');
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });

    const job = await db.getJobById(id, companyId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Same bounded, recall-first pre-filter the monolith's original endpoint used
    // (getCandidatesForJobScoring) - now served by candidate-core-service's own mirror.
    const candidates = await getCandidatesForJobScoring(companyId, job.required_skills, 1500);
    const ranked = await rankCandidatesForJob(job, candidates, {
      tier: 'full',
      persist: { companyId, source: 'job_detail' },
    });
    const matchedCandidates = ranked.map(({ candidate, match_score, score }) => ({
      candidate,
      match_score,
      breakdown: score!.breakdown,
      summary: score!.summary,
    }));

    res.json({ job, matched_candidates: matchedCandidates });
  } catch (error) {
    logger.error({ err: (error as Error).message, jobId: req.params.id }, 'Failed to load job detail');
    res.status(502).json({ error: 'Upstream scoring data is currently unavailable. Please try again.' });
  }
});

router.put('/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });
    const companyId = req.user!.company_id;
    const updated = await db.updateJob(id, companyId, jobUpdatePayloadFromBody(req.body));
    if (!updated) {
      return res.status(404).json({ error: 'Job not found' });
    }
    await monolithClient.mirrorAndNotifyJobUpdate(updated);

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    refreshRecruiterReviewViewForJobs([id]);

    res.json(updated);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to update job');
    res.status(500).json({ error: 'Failed to update job' });
  }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });
    const companyId = req.user!.company_id;
    const deleted = await db.deleteJob(id, companyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Job not found or could not be deleted' });
    }

    // Item 7: Remove from RAG index
    const { removeJobFromIndex } = await import('../rag.service.js');
    removeJobFromIndex(id).catch(() => {});

    await monolithClient.mirrorDeleteJob(id, companyId);

    // Remaining-monolith migration, Item 5 - CQRS: refresh recruiter review view (fire-and-forget).
    refreshRecruiterReviewViewForJobs([id]);

    res.status(200).json({ success: true, message: 'Job deleted successfully' });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to delete job');
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

export default router;
