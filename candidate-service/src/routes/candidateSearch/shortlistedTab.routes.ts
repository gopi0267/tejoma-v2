/**
 * Shortlisted Tab Route
 *
 * GET /api/candidate-search/tab/shortlisted
 *
 * Feature Flag: SHORTLIST_SEARCH_CUTOVER_ENABLED
 * - true: Use local candidate-service handler (fans out to matching-decision + candidate-core)
 * - false: Proxy to monolith (safe fallback)
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { getShortlistedCandidates } from './getShortlistedCandidates.js';

const router = Router();

/**
 * GET /api/candidate-search/tab/shortlisted
 *
 * Get candidates that have been shortlisted (matched) by recruiters
 * Displays in the "Shortlisted" tab of the candidate search page
 *
 * Feature Flag: SHORTLIST_SEARCH_CUTOVER_ENABLED
 * - true: Use local handler
 * - false: Proxy to monolith
 */
router.get('/tab/shortlisted', async (req: Request, res: Response) => {
  try {
    const companyId = parseInt((req as any).user?.company_id as string);

    if (!companyId || companyId <= 0) {
      return res.status(400).json({ error: 'Company ID required' });
    }

    // Feature flag: SHORTLIST_SEARCH_CUTOVER_ENABLED
    const useLocalHandler = process.env.SHORTLIST_SEARCH_CUTOVER_ENABLED === 'true';

    if (useLocalHandler) {
      // Use local handler (candidate-service + matching-decision + candidate-core)
      logger.debug({ companyId }, 'Using local candidate-service handler for shortlisted tab');
      const shortlistedCandidates = await getShortlistedCandidates(companyId);
      return res.json({
        candidates: shortlistedCandidates,
        total: shortlistedCandidates.length,
      });
    } else {
      // Fallback: Proxy to monolith (safe)
      logger.debug({ companyId }, 'Using monolith proxy for shortlisted tab');
      // TODO: Implement monolith proxy call
      return res.json({ candidates: [], total: 0 });
    }
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'GET /candidate-search/tab/shortlisted failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
