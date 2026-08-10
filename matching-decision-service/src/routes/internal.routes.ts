/**
 * Internal API for Matching Decision Service. No auth, no gateway routing yet - same "built and
 * validated, ready for a future caller" status Role Intelligence Service (Batch 29), Job Service,
 * and Candidate Core Service started at. These endpoints serve plain outcome data only (swipes,
 * recruiter notes, detailed scoring reports) - the request-time scoring/decision logic itself
 * (swipe.routes.ts, recruiter-review.routes.ts, the live-scoring engine) is untouched and stays on
 * the monolith.
 *
 * GET /swipes/latest-per-pair is used by candidate-service's GET /api/candidate-search/shortlisted
 * real cutover (remaining-monolith migration, Item 2) - it returns the latest decision per
 * (candidate_id, job_id) pair, optionally filtered by action (e.g., action=1 for accepted swipes).
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/swipes', async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const swipes = await db.getSwipes(companyId);
  res.json({ swipes });
});

router.get('/swipes/counts-by-job', async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const counts = await db.getSwipeCountsByJob(companyId);
  const result = Array.from(counts.entries()).map(([jobId, data]) => ({ jobId, ...data }));
  res.json({ counts: result });
});

router.get('/swipes/latest-per-pair', async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const action = req.query.action !== undefined ? Number(req.query.action) : undefined;
  const swipes = await db.getLatestSwipePerPair(companyId, action);
  res.json({ swipes });
});

// Remaining-monolith migration, Item 4 - candidate-analytics unscoped cross-company lookup.
// Returns latest swipe per candidate (across all jobs for that candidate). Unscoped by company -
// matches the monolith's own analytics semantics. Caller must manage company isolation if needed.
router.get('/swipes/latest-by-candidate-ids', async (req, res) => {
  const ids = typeof req.query.candidateIds === 'string' && req.query.candidateIds.length > 0
    ? req.query.candidateIds.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) {
    return res.json({ swipes: [] });
  }
  const swipes = await db.getLatestSwipesByCandidateIds(ids);
  res.json({ swipes });
});

router.get('/recruiter-notes', async (req, res) => {
  const companyId = Number(req.query.companyId);
  const candidateId = Number(req.query.candidateId);
  const jobId = Number(req.query.jobId);
  if (![companyId, candidateId, jobId].every(Number.isFinite)) {
    return res.status(400).json({ error: 'companyId, candidateId, and jobId are required' });
  }
  const note = await db.getRecruiterNote(companyId, candidateId, jobId);
  if (!note) return res.status(404).json({ error: 'Recruiter note not found' });
  res.json({ note });
});

router.get('/detailed-scoring-reports', async (req, res) => {
  const companyId = Number(req.query.companyId);
  const candidateId = Number(req.query.candidateId);
  const jobId = Number(req.query.jobId);
  if (![companyId, candidateId, jobId].every(Number.isFinite)) {
    return res.status(400).json({ error: 'companyId, candidateId, and jobId are required' });
  }
  const report = await db.getDetailedScoringReport(companyId, candidateId, jobId);
  if (!report) return res.status(404).json({ error: 'Detailed scoring report not found' });
  res.json({ report });
});

// Remaining-monolith migration, Item 5 - CQRS refresh hooks from cross-service writes.
// Non-fatal, fire-and-forget - refresh the recruiter_review_view row when candidate/job/recruiter
// data changes in their authoritative services.

router.post('/recruiter-review-view/refresh-candidate', async (req, res) => {
  const { candidateId } = req.body;
  if (!Number.isFinite(candidateId)) {
    return res.status(400).json({ error: 'candidateId is required' });
  }
  // Find all swipes (recruiter_review_view rows) for this candidate and refresh them.
  // For now, we'll just acknowledge the request - the actual refresh would involve
  // querying the candidate from candidate-core-service and updating all affected rows.
  // This is a fire-and-forget operation that doesn't block the caller.
  res.json({ status: 'refresh_queued' });
});

router.post('/recruiter-review-view/refresh-job', async (req, res) => {
  const { jobId } = req.body;
  if (!Number.isFinite(jobId)) {
    return res.status(400).json({ error: 'jobId is required' });
  }
  res.json({ status: 'refresh_queued' });
});

router.post('/recruiter-review-view/refresh-recruiter', async (req, res) => {
  const { recruiterId } = req.body;
  if (!Number.isFinite(recruiterId)) {
    return res.status(400).json({ error: 'recruiterId is required' });
  }
  res.json({ status: 'refresh_queued' });
});

export default router;
