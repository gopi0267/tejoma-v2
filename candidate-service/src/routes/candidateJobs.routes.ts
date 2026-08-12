/**
 * Candidate Jobs - Real cutover (calls job-service instead of monolith)
 * Lists open jobs and provides job details for candidates
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { JOB_SERVICE_URL } from '../config/env.js';

const router = Router();
router.use(requireCandidateAuth);

async function callJobService(path: string, params?: Record<string, string>) {
  try {
    const url = new URL(`${JOB_SERVICE_URL}/api/jobs${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, 'Job service returned non-ok status');
      return null;
    }
    return await res.json();
  } catch (error) {
    logger.warn({ err: (error as Error).message, path }, 'Failed to call job-service');
    return null;
  }
}

// ==================== BROWSE / SEARCH OPEN JOBS ====================
router.get('/candidate-jobs', async (req, res) => {
  try {
    const { search, skill, location, company, page = '0', pageSize = '20' } = req.query;
    const params: Record<string, string> = {
      page: typeof page === 'string' ? page : '0',
      pageSize: typeof pageSize === 'string' ? pageSize : '20',
    };

    if (typeof search === 'string') params.search = search;
    if (typeof skill === 'string') params.skill = skill;
    if (typeof location === 'string') params.location = location;
    if (typeof company === 'string') params.company = company;

    const result = await callJobService('', params);
    if (!result) {
      return res.status(503).json({ error: 'Job service temporarily unavailable' });
    }
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load jobs');
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// ==================== JOB DETAIL ====================
router.get('/candidate-jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const result = await callJobService(`/${id}`);
    if (!result) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load job');
    res.status(500).json({ error: 'Failed to load job' });
  }
});

// ==================== MATCH EXPLANATION ====================
router.get('/candidate-jobs/:id/explanation', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    // TODO: Implement match explanation - for now, return a placeholder
    res.json({
      jobId: id,
      explanation: 'Match explanation coming soon',
      score: null
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load match explanation');
    res.status(500).json({ error: 'Failed to load explanation' });
  }
});

export default router;
