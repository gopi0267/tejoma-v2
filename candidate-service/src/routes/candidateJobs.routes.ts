/**
 * Ported from the monolith's src/api/candidate-jobs.routes.ts - byte-identical response shapes.
 * Job data, match ranking, and match explanation still belong to the monolith's Recruiting/
 * Matching domain (config/env.ts's header comment), so every handler here proxies to
 * src/api/candidate-internal.routes.ts via monolithClient.ts rather than duplicating that logic.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { MonolithProxyError, getOpenJobsForCandidate, getOpenJobForCandidate, getJobExplanationForCandidate } from '../services/monolithClient.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireCandidateAuth);

// Any error reaching here means the call to the monolith's internal API did not complete
// cleanly - whether that's a clean non-400/404 HTTP error response (MonolithProxyError) or a
// genuine network failure (connection refused, timeout - a plain Error, not a MonolithProxyError,
// since monolithClient.ts's fetch() call itself threw before ever producing a status code), both
// are "the upstream is unavailable," which is exactly what 502 means - never fall through to a
// generic 500 for what is actually an upstream connectivity problem.
function respondToProxyError(res: import('express').Response, error: unknown, fallbackMessage: string) {
  if (error instanceof MonolithProxyError) {
    if (error.status === 404) return res.status(404).json(error.body);
    if (error.status === 400) return res.status(400).json(error.body);
  } else {
    logger.error({ err: (error as Error).message }, fallbackMessage);
  }
  res.status(502).json({ error: 'Upstream job data is currently unavailable. Please try again.' });
}

// ==================== BROWSE / SEARCH OPEN JOBS ====================
router.get('/candidate-jobs', async (req, res) => {
  try {
    const { search, skill, location, company, page, pageSize } = req.query;
    const result = await getOpenJobsForCandidate(req.candidate!.candidate_id, {
      search: typeof search === 'string' ? search : undefined,
      skill: typeof skill === 'string' ? skill : undefined,
      location: typeof location === 'string' ? location : undefined,
      company: typeof company === 'string' ? company : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load jobs');
  }
});

// ==================== JOB DETAIL ====================
router.get('/candidate-jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const job = await getOpenJobForCandidate(req.candidate!.candidate_id, id);
    res.json(job);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load job');
  }
});

// ==================== MATCH EXPLANATION ====================
router.get('/candidate-jobs/:id/explanation', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const explanation = await getJobExplanationForCandidate(req.candidate!.candidate_id, id);
    res.json(explanation);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load match explanation');
  }
});

export default router;
