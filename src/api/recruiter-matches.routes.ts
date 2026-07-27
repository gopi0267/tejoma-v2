import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

// ==================== MATCHES INVOLVING THE RECRUITER'S JOBS ====================
// A brand-new, standalone file so swipe.routes.ts/recruiter-review.routes.ts are never
// touched. Company-scoped; getRecruiterMatches only returns the linked candidates row's data
// (the same kind of data a recruiter already sees for any candidate) - never candidate_accounts
// fields, never another company's data.
router.get('/matches', async (req, res) => {
  try {
    const jobId = req.query.job_id ? parseInt(req.query.job_id as string, 10) : undefined;
    // userId scopes the notification LEFT JOIN (Phase 4) to this viewer's own read/unread
    // state - recruiter notifications are personal, never shared across colleagues.
    const matches = await db.getRecruiterMatches(req.user!.company_id, jobId, req.user!.user_id);
    res.json({ matches });
  } catch (error) {
    console.error('Recruiter matches error:', error);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
