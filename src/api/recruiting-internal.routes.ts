/**
 * Internal, service-to-service endpoint for Recruiting Service (Batch 19) - GET /api/matches
 * needs mutual_matches joined with jobs and candidates, the two things this monolith still owns
 * that recruiter_notifications alone can't answer. Mirrors the trust model every other Tier 0
 * service's /internal/* already documents: no JWT here, gated by network boundary (API Gateway's
 * proxy.ts already 404s /internal/* unconditionally; Recruiting Service calls this directly via
 * MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * The handler is a thin wrapper around the EXACT db.ts function the monolith's own
 * src/api/recruiter-matches.routes.ts already calls (db.getRecruiterMatches) - same query, same
 * company/user scoping, same data. Nothing here is new business logic; only the entry point moved
 * from "call directly, in-process" to "trust the network boundary, read companyId/userId from the
 * request."
 */
import { Router } from 'express';
import { getRecruiterMatches } from '../db.js';

const router = Router();

router.get('/matches', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const jobId = req.query.jobId ? parseInt(String(req.query.jobId), 10) : undefined;
    const userId = req.query.userId ? parseInt(String(req.query.userId), 10) : undefined;
    const matches = await getRecruiterMatches(companyId, jobId, userId);
    res.json({ matches });
  } catch (error) {
    console.error('[internal/recruiting] matches error:', error);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
