/**
 * Ported from the monolith's src/api/candidate-applications.routes.ts - byte-identical response
 * shapes. Applications are derived from candidate_decisions joined with jobs (monolith-owned),
 * so proxied via monolithClient.ts.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { MonolithProxyError, getCandidateApplications, getCandidateApplication } from '../services/monolithClient.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireCandidateAuth);

// See candidateJobs.routes.ts's respondToProxyError for why any error here - clean or a genuine
// network failure - maps to 502, never a generic 500.
function respondToProxyError(res: import('express').Response, error: unknown, fallbackMessage: string) {
  if (error instanceof MonolithProxyError) {
    if (error.status === 404) return res.status(404).json(error.body);
    if (error.status === 400) return res.status(400).json(error.body);
  } else {
    logger.error({ err: (error as Error).message }, fallbackMessage);
  }
  res.status(502).json({ error: 'Upstream application data is currently unavailable. Please try again.' });
}

router.get('/candidate-applications', async (req, res) => {
  try {
    const result = await getCandidateApplications(req.candidate!.candidate_id);
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load applications');
  }
});

router.get('/candidate-applications/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const application = await getCandidateApplication(req.candidate!.candidate_id, jobId);
    res.json(application);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load application');
  }
});

export default router;
