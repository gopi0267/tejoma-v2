import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// Remaining-monolith migration, Step 5 - the one candidate-search.routes.ts endpoint that stays
// monolith-authoritative: "shortlisted" joins `swipes` (matching-decision-service's Step 6 domain,
// not done) and `candidates` (candidate-core-service's own table) - a cross-service join candidate-
// service can't perform locally. Returns raw CandidateAccount rows (no shaping) so candidate-
// service applies its own toSearchResultShape uniformly across every tab, real or proxied.
router.get('/shortlisted', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
    const candidates = await db.getShortlistedCandidateAccounts(companyId);
    res.json({ candidates });
  } catch (error: any) {
    console.error('[internal/candidate-search] shortlisted error:', error);
    res.status(500).json({ error: 'Failed to load shortlisted candidates: ' + error.message });
  }
});

export default router;
