/**
 * Recruiter Review View Refresh Endpoints (Internal)
 *
 * Phase 4, Item 5: Cross-service hooks for view refresh
 *
 * Called by:
 * - candidate-core-service: POST /internal/recruiter-review-view/refresh-candidate
 * - job-service: POST /internal/recruiter-review-view/refresh-job
 * - identity-service: POST /internal/recruiter-review-view/refresh-recruiter
 *
 * All endpoints:
 * - Best-effort (never fail the caller's request)
 * - Fire-and-forget (respond immediately, process async)
 * - Logged on failure (never silent)
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import {
  refreshRecruiterReviewViewForCandidates,
  refreshRecruiterReviewViewForJobs,
  refreshRecruiterReviewViewForRecruiters,
} from '../../db/recruiterReviewView.js';

const router = Router();

/**
 * POST /internal/recruiter-review-view/refresh-candidate
 * Called by candidate-core-service when a candidate is created/updated/deleted
 */
router.post('/recruiter-review-view/refresh-candidate', async (req: Request, res: Response) => {
  try {
    const { candidateIds } = req.body;

    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      logger.debug('No candidate IDs provided for recruiter_review_view refresh');
      return res.status(400).json({ error: 'candidateIds array required' });
    }

    // Fire-and-forget: respond immediately, process async
    res.status(202).json({ message: 'Refresh requested' });

    // Process in background (don't await)
    refreshRecruiterReviewViewForCandidates(candidateIds).catch((err) => {
      logger.error(
        { err: (err as Error).message, candidateIds },
        'Background refresh failed for candidates'
      );
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'recruiter-review-view refresh-candidate error');
    res.status(500).json({ error: 'Refresh request processing failed' });
  }
});

/**
 * POST /internal/recruiter-review-view/refresh-job
 * Called by job-service when a job is created/updated/deleted
 */
router.post('/recruiter-review-view/refresh-job', async (req: Request, res: Response) => {
  try {
    const { jobIds } = req.body;

    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      logger.debug('No job IDs provided for recruiter_review_view refresh');
      return res.status(400).json({ error: 'jobIds array required' });
    }

    // Fire-and-forget
    res.status(202).json({ message: 'Refresh requested' });

    refreshRecruiterReviewViewForJobs(jobIds).catch((err) => {
      logger.error(
        { err: (err as Error).message, jobIds },
        'Background refresh failed for jobs'
      );
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'recruiter-review-view refresh-job error');
    res.status(500).json({ error: 'Refresh request processing failed' });
  }
});

/**
 * POST /internal/recruiter-review-view/refresh-recruiter
 * Called by identity-service when a recruiter's name/status changes
 */
router.post('/recruiter-review-view/refresh-recruiter', async (req: Request, res: Response) => {
  try {
    const { recruiterIds } = req.body;

    if (!Array.isArray(recruiterIds) || recruiterIds.length === 0) {
      logger.debug('No recruiter IDs provided for recruiter_review_view refresh');
      return res.status(400).json({ error: 'recruiterIds array required' });
    }

    // Fire-and-forget
    res.status(202).json({ message: 'Refresh requested' });

    refreshRecruiterReviewViewForRecruiters(recruiterIds).catch((err) => {
      logger.error(
        { err: (err as Error).message, recruiterIds },
        'Background refresh failed for recruiters'
      );
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'recruiter-review-view refresh-recruiter error');
    res.status(500).json({ error: 'Refresh request processing failed' });
  }
});

export default router;
