/**
 * Ported from the monolith's src/api/candidate-matches.routes.ts - byte-identical response shape.
 * mutual_matches has real foreign keys into jobs/companies/candidates (monolith-owned), so
 * proxied via monolithClient.ts.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { MonolithProxyError, getCandidateMatches } from '../services/monolithClient.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireCandidateAuth);

router.get('/candidate-matches', async (req, res) => {
  try {
    const result = await getCandidateMatches(req.candidate!.candidate_id);
    res.json(result);
  } catch (error) {
    // See candidateJobs.routes.ts's respondToProxyError for why any error here - clean or a
    // genuine network failure - maps to 502, never a generic 500.
    if (!(error instanceof MonolithProxyError)) {
      logger.error({ err: (error as Error).message }, 'Failed to load matches');
    }
    res.status(502).json({ error: 'Upstream match data is currently unavailable. Please try again.' });
  }
});

export default router;
