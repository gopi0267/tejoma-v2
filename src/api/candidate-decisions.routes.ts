import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();

// requireCandidateAuth is applied per-route (not router.use()) - same reasoning as
// candidate-profile.routes.ts/candidate-jobs.routes.ts: this router sits ahead of swipeRouter
// (blanket staff-only auth) in src/api/index.ts, so a blanket gate here would 401 every staff
// request headed for swipeRouter before it arrived.

const DECISION_TO_ACTION: Record<string, number> = { swipe_right: 1, swipe_left: 0, apply: 1 };

// ==================== RECORD A DECISION (swipe right/left, or apply) ====================
router.post('/candidate-decisions', requireCandidateAuth, async (req, res) => {
  try {
    const { job_id, decision_type } = req.body;
    const jobId = parseInt(job_id, 10);
    if (Number.isNaN(jobId) || !['swipe_right', 'swipe_left', 'apply'].includes(decision_type)) {
      return res.status(400).json({ error: 'job_id and a valid decision_type are required' });
    }

    // Candidate cannot swipe/apply on closed jobs - reuses the same existing, tested function
    // that already backs the candidate job-discovery/detail endpoints.
    const job = await db.getOpenJobByIdPublic(jobId);
    if (!job) {
      return res.status(404).json({ error: 'This job is not open' });
    }

    const candidateAccountId = req.candidate!.candidate_id;
    const action = DECISION_TO_ACTION[decision_type];

    // Candidate cannot submit a duplicate active decision (same action as their current one).
    const latest = await db.getLatestCandidateDecision(candidateAccountId, jobId);
    if (latest && Number(latest.action) === action) {
      return res.status(400).json({ error: 'You have already made this decision for this job' });
    }

    const decision = await db.recordCandidateDecision({ candidateAccountId, jobId, action, decisionType: decision_type });
    if (!decision) {
      return res.status(500).json({ error: 'Failed to record decision' });
    }

    // Positive decisions enter the candidate into the recruiter's existing swipe pipeline
    // (auto-create/reuse a linked candidates row) and are checked for an immediate match -
    // covers the "candidate is the second mover" case (recruiter already said yes earlier).
    if (action === 1) {
      const companyId = await db.getJobCompanyId(jobId);
      if (companyId) {
        await db.getOrCreateLinkedCandidateRow(candidateAccountId, companyId);
        await db.evaluateAndCreateMutualMatch(candidateAccountId, jobId);
      }
    }

    res.status(201).json({ decision });
  } catch (error) {
    console.error('Candidate decision error:', error);
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

// ==================== FULL DECISION HISTORY ====================
router.get('/candidate-decisions', requireCandidateAuth, async (req, res) => {
  try {
    const decisions = await db.getCandidateDecisions(req.candidate!.candidate_id);
    res.json({ decisions });
  } catch (error) {
    console.error('Candidate decision history error:', error);
    res.status(500).json({ error: 'Failed to load decision history' });
  }
});

// ==================== ACTIVE (LATEST-PER-JOB) DECISIONS ====================
router.get('/candidate-decisions/active', requireCandidateAuth, async (req, res) => {
  try {
    const { action } = req.query;
    const parsedAction = action !== undefined ? parseInt(action as string, 10) : undefined;
    const decisions = await db.getCandidateActiveDecisions(req.candidate!.candidate_id, parsedAction);
    res.json({ decisions });
  } catch (error) {
    console.error('Candidate active decisions error:', error);
    res.status(500).json({ error: 'Failed to load decisions' });
  }
});

// ==================== LIKES TAB STATUS (Explore/Likes redesign) ====================
// Derives a display-only status from data that already exists - no new table, no write.
// 'waiting'    - no linked candidates row for this company yet, or one exists with no swipe on
//                this job (the recruiter hasn't acted).
// 'interested' - recruiter swipe action 1 (accepted) or 0.5 (shortlisted/saved) exists - both
//                read as positive recruiter engagement; action=1 specifically is already a
//                Match (see mutual_matches), which the Matches tab surfaces separately.
// 'rejected'   - recruiter swipe action 0 exists.
// 'expired'    - still waiting, but the candidate's own decision is older than 30 days - a pure
//                display label computed from the existing decision timestamp, nothing stored.
const LIKE_EXPIRY_DAYS = 30;

router.get('/candidate-decisions/status/:jobId', requireCandidateAuth, async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const candidateAccountId = req.candidate!.candidate_id;

    const recruiterDecision = await db.getRecruiterDecisionForCandidateJob(candidateAccountId, jobId);
    if (recruiterDecision) {
      const status = recruiterDecision.action === 0 ? 'rejected' : 'interested';
      return res.json({ status });
    }

    const ownDecision = await db.getLatestCandidateDecision(candidateAccountId, jobId);
    if (ownDecision) {
      const ageMs = Date.now() - new Date(ownDecision.timestamp).getTime();
      if (ageMs > LIKE_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
        return res.json({ status: 'expired' });
      }
    }
    res.json({ status: 'waiting' });
  } catch (error) {
    console.error('Candidate decision status error:', error);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

export default router;
