import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Gated per-route (not router.use()) - same reasoning as every other candidate-facing router:
// this sits ahead of swipeRouter in src/api/index.ts, so a blanket gate here would 401 staff
// requests headed for later routers. Every query below is scoped server-side to
// req.candidate.candidate_id - ownership is never inferred from params alone. Never selects
// recruiter_notes, match_scores, or detailed_scoring_reports - only job/company/status fields.

router.get('/candidate-applications', requireCandidateAuth, async (req, res) => {
  try {
    const applications = await db.getCandidateApplications(req.candidate!.candidate_id);
    res.json({ applications });
  } catch (error) {
    console.error('Candidate applications list error:', error);
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

router.get('/candidate-applications/:jobId', requireCandidateAuth, async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const application = await db.getCandidateApplication(req.candidate!.candidate_id, jobId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json(application);
  } catch (error) {
    console.error('Candidate application detail error:', error);
    res.status(500).json({ error: 'Failed to load application' });
  }
});

export default router;
