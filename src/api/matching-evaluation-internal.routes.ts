/**
 * Internal, service-to-service endpoints for Matching Evaluation Service (Batch 24, extended
 * Batch 25) - swipe/candidate/job data (for evaluation and LTR training), the live scoring
 * engine's feature-vector computation, and job titles (for shadowDataHealth.ts's seniority
 * inference) - things this monolith still owns. Mirrors the trust model every other Tier 0
 * service's /internal/* already documents: no JWT here, gated by network boundary (API Gateway's
 * proxy.ts already 404s /internal/* unconditionally; Matching Evaluation Service calls this
 * directly via MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * Every handler is a thin wrapper around the EXACT db.ts/services.ts functions the monolith's own
 * src/matching/evaluation.ts, learningToRank.ts, and shadowDataHealth.ts already call (all three
 * are UNCHANGED and continue running in-process for real traffic - this is a second entry point
 * into the same logic, not a replacement). Nothing here is new business logic.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { calculateMatchScoresBatch } from '../matching/services.js';

const router = Router();

router.get('/swipes-for-evaluation', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const swipes = await db.getSwipesForEvaluation(companyId);
    res.json({ swipes });
  } catch (error) {
    console.error('[internal/matching-evaluation] swipes-for-evaluation error:', error);
    res.status(500).json({ error: 'Failed to load swipes for evaluation' });
  }
});

router.get('/training-data', async (_req, res) => {
  try {
    const [swipes, candidates, jobs] = await Promise.all([
      db.getAllSwipesUnscoped(),
      db.getAllCandidatesUnscoped(),
      db.getAllJobsUnscoped(),
    ]);
    res.json({ swipes, candidates, jobs });
  } catch (error) {
    console.error('[internal/matching-evaluation] training-data error:', error);
    res.status(500).json({ error: 'Failed to load training data' });
  }
});

router.post('/score-batch', async (req, res) => {
  try {
    const { job, candidates, options } = req.body;
    if (!job || !Array.isArray(candidates)) {
      return res.status(400).json({ error: 'job and candidates[] are required' });
    }
    const results = await calculateMatchScoresBatch(job, candidates, options);
    res.json({ results });
  } catch (error) {
    console.error('[internal/matching-evaluation] score-batch error:', error);
    res.status(500).json({ error: 'Failed to score batch' });
  }
});

router.get('/job-titles', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    const jobIdsParam = String(req.query.jobIds || '');
    if (Number.isNaN(companyId) || !jobIdsParam) {
      return res.status(400).json({ error: 'companyId and jobIds are required' });
    }
    const jobIds = jobIdsParam.split(',').map((s) => parseInt(s, 10)).filter((n) => !Number.isNaN(n));
    const jobs = await Promise.all(jobIds.map((id) => db.getJobById(id, companyId)));
    res.json({ jobs: jobs.filter((j): j is NonNullable<typeof j> => j !== null).map((j) => ({ id: j.id, title: j.title })) });
  } catch (error) {
    console.error('[internal/matching-evaluation] job-titles error:', error);
    res.status(500).json({ error: 'Failed to load job titles' });
  }
});

export default router;
