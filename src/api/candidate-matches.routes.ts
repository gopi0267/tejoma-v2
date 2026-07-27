import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();

// ==================== CANDIDATE'S OWN MATCHES ====================
// getCandidateMatches never joins/returns swipes, recruiter_notes, match_scores, or
// detailed_scoring_reports - only job/company safe fields plus the match timestamp.
router.get('/candidate-matches', requireCandidateAuth, async (req, res) => {
  try {
    const matches = await db.getCandidateMatches(req.candidate!.candidate_id);
    res.json({ matches });
  } catch (error) {
    console.error('Candidate matches error:', error);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
