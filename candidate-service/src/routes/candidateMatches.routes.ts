/**
 * Candidate Matches - Real cutover (no longer proxies to monolith)
 * Matches are mutual matches tracked in mutual_matches table (candidate-service owned)
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireCandidateAuth);

router.get('/candidate-matches', async (req, res) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const matches = await db.getCandidateMatches(candidateAccountId);
    res.json({ matches });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load matches');
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
