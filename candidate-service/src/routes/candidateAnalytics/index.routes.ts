/**
 * Candidate Analytics Routes
 *
 * Phase 4, Item 4: GET /api/candidate-analytics
 * Fetches analytics for the authenticated candidate
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { computeCandidateAnalytics } from './computeAnalytics.js';
import { CANDIDATE_ANALYTICS_CUTOVER_ENABLED } from '../../config/env.js';
import { monolithClient } from '../../services/monolithClient.js';

const router = Router();

router.get('/candidate-analytics', async (req: Request, res: Response) => {
  try {
    const candidateId = req.candidate?.candidate_id;

    if (!candidateId) {
      logger.debug('Missing candidate ID in request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (CANDIDATE_ANALYTICS_CUTOVER_ENABLED) {
      // Real cutover: use local implementation
      const analytics = await computeCandidateAnalytics(candidateId);
      if (!analytics) {
        return res.status(404).json({ error: 'Candidate not found' });
      }
      return res.json(analytics);
    } else {
      // Fallback: proxy to monolith
      const analytics = await monolithClient.get(
        `/api/candidate-analytics`,
        { params: { candidateId } }
      );
      return res.json(analytics.data);
    }
  } catch (error) {
    logger.error(
      { err: (error as Error).message },
      'Failed to get candidate analytics'
    );
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

export default router;
