/**
 * Ported from the monolith's src/api/candidate-decisions.routes.ts - byte-identical response
 * shapes and validation. Decision persistence and the recruiter-match fan-out
 * (getOrCreateLinkedCandidateRow + evaluateAndCreateMutualMatch) still belong to the monolith
 * (candidate_decisions/mutual_matches have real foreign keys into jobs/candidates/companies) -
 * proxied via monolithClient.ts to preserve identical business behavior, not duplicated.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { MonolithProxyError, recordCandidateDecision, getCandidateDecisions, getCandidateActiveDecisions, getCandidateDecisionStatus } from '../services/monolithClient.js';
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
  res.status(502).json({ error: 'Upstream decision data is currently unavailable. Please try again.' });
}

// ==================== RECORD A DECISION (swipe right/left, or apply) ====================
router.post('/candidate-decisions', async (req, res) => {
  try {
    const { job_id, decision_type } = req.body;
    const jobId = parseInt(job_id, 10);
    if (Number.isNaN(jobId) || !['swipe_right', 'swipe_left', 'apply'].includes(decision_type)) {
      return res.status(400).json({ error: 'job_id and a valid decision_type are required' });
    }
    const result = await recordCandidateDecision(req.candidate!.candidate_id, jobId, decision_type);
    res.status(201).json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to record decision');
  }
});

// ==================== FULL DECISION HISTORY ====================
router.get('/candidate-decisions', async (req, res) => {
  try {
    const result = await getCandidateDecisions(req.candidate!.candidate_id);
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load decision history');
  }
});

// ==================== ACTIVE (LATEST-PER-JOB) DECISIONS ====================
router.get('/candidate-decisions/active', async (req, res) => {
  try {
    const { action } = req.query;
    const parsedAction = action !== undefined ? parseInt(action as string, 10) : undefined;
    const result = await getCandidateActiveDecisions(req.candidate!.candidate_id, parsedAction);
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load decisions');
  }
});

// ==================== LIKES TAB STATUS ====================
router.get('/candidate-decisions/status/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const result = await getCandidateDecisionStatus(req.candidate!.candidate_id, jobId);
    res.json(result);
  } catch (error) {
    respondToProxyError(res, error, 'Failed to load status');
  }
});

export default router;
