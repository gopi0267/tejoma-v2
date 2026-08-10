/**
 * Recruiter Matches Routes (Remaining-monolith migration, Step 5)
 *
 * GET /matches is now a real cutover: orchestrates candidate-service (mutual_matches),
 * job-service (jobs), candidate-core-service (candidates), and recruiting-service's own
 * recruiter_notifications, merging all data for recruiter-facing match listing.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { getRecruiterMatches as getRecruiterMatchesFromMonolith, MonolithProxyError } from '../services/monolithClient.js';
import { getRecruiterMatches } from './matches/getRecruiterMatches.js';
import { RECRUITER_MATCHES_CUTOVER_ENABLED } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/matches', async (req, res) => {
  try {
    const jobId = req.query.job_id ? parseInt(String(req.query.job_id), 10) : undefined;

    if (!RECRUITER_MATCHES_CUTOVER_ENABLED) {
      // Fallback to monolith proxy
      const { matches } = await getRecruiterMatchesFromMonolith(req.user!.company_id, jobId, req.user!.user_id);
      return res.json({ matches });
    }

    // Real implementation: orchestrate cross-service calls
    const matches = await getRecruiterMatches(
      req.user!.company_id,
      jobId,
      req.user!.user_id
    );
    res.json({ matches });
  } catch (error: any) {
    if (error instanceof MonolithProxyError) {
      logger.error({ status: error.status }, 'Failed to reach monolith for recruiter matches');
      return res.status(502).json({ error: 'Failed to load matches. Please try again.' });
    }
    logger.error({ err: error.message }, 'Failed to load recruiter matches');
    res.status(500).json({ error: 'Failed to load matches. Please try again.' });
  }
});

export default router;
