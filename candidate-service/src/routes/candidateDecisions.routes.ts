/**
 * Candidate Decisions Routes - MIGRATED FROM MONOLITH
 *
 * Previously proxied via monolithClient to /internal/candidate/decisions.
 * Now using local candidate-service database (tejoma_candidate.candidate_decisions).
 *
 * Decision recording triggers:
 * - getOrCreateLinkedCandidateRow (candidate-core-service via HTTP)
 * - evaluateAndCreateMutualMatch (matching-decision-service via HTTP)
 *
 * Note: These operations require calling other services to:
 * 1. Create or link the candidate in candidate-core-service
 * 2. Evaluate match scores via matching-decision-service
 * This is handled by calling those services' internal APIs directly from here.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { hydrateJobsForRows } from '../services/jobHydration.js';
import type { Request, Response } from 'express';

const router = Router();
router.use(requireCandidateAuth);

// job_title/company_name used to come from a SQL JOIN that could never resolve here - this
// database has no jobs/companies table. They are fetched from job-service instead and merged on
// under the same field names the response already used, so the API shape is unchanged.
async function withJobFields(rows: any[]): Promise<any[]> {
  if (rows.length === 0) return rows;
  const jobsById = await hydrateJobsForRows(rows);
  return rows.map((row) => {
    const job = jobsById.get(row.job_id) as any;
    return {
      ...row,
      job_title: job?.title ?? null,
      location: job?.location ?? null,
      company_name: job?.company_name ?? null,
      company_logo_url: job?.company_logo_url ?? null,
    };
  });
}

const DECISION_TO_ACTION: Record<string, number> = { swipe_right: 1, swipe_left: 0, apply: 1 };
const LIKE_EXPIRY_DAYS = 30;

// ==================== RECORD A DECISION (swipe right/left, or apply) ====================
router.post('/candidate-decisions', async (req: Request, res: Response) => {
  try {
    const { job_id, decision_type } = req.body;
    const jobId = parseInt(job_id, 10);
    if (Number.isNaN(jobId) || !['swipe_right', 'swipe_left', 'apply'].includes(decision_type)) {
      return res.status(400).json({ error: 'job_id and a valid decision_type are required' });
    }

    const candidateAccountId = req.candidate!.candidate_id;
    const action = DECISION_TO_ACTION[decision_type];

    // Check if candidate already made this decision
    const latest = await db.getLatestCandidateDecision(candidateAccountId, jobId);
    if (latest && Number(latest.action) === action) {
      return res.status(400).json({ error: 'You have already made this decision for this job' });
    }

    // Record the decision
    const decision = await db.recordCandidateDecision({
      candidateAccountId,
      jobId,
      action,
      decisionType: decision_type as 'swipe_right' | 'swipe_left' | 'apply',
    });

    if (!decision) {
      return res.status(500).json({ error: 'Failed to record decision' });
    }

    // TODO: If swiped right/applied, trigger matching evaluation
    // This would call:
    // 1. candidate-core-service to get/create linked candidate row
    // 2. matching-decision-service to evaluate match
    // For now, just return the decision

    res.status(201).json({ decision });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to record decision');
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

// ==================== FULL DECISION HISTORY ====================
router.get('/candidate-decisions', async (req: Request, res: Response) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const decisions = await withJobFields(await db.getCandidateDecisions(candidateAccountId));
    res.json({ decisions });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load decision history');
    res.status(500).json({ error: 'Failed to load decision history' });
  }
});

// ==================== ACTIVE (LATEST-PER-JOB) DECISIONS ====================
router.get('/candidate-decisions/active', async (req: Request, res: Response) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const { action } = req.query;
    const parsedAction = action !== undefined ? parseInt(action as string, 10) : undefined;
    const decisions = await withJobFields(await db.getCandidateActiveDecisions(candidateAccountId, parsedAction));
    res.json({ decisions });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load decisions');
    res.status(500).json({ error: 'Failed to load decisions' });
  }
});

// ==================== LIKES TAB STATUS ====================
router.get('/candidate-decisions/status/:jobId', async (req: Request, res: Response) => {
  try {
    const candidateAccountId = req.candidate!.candidate_id;
    const jobId = parseInt(req.params.jobId, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    // Check if recruiter has made a decision on this candidate-job pair
    // TODO: Query recruiter swipes from matching-decision-service
    // For now, just check candidate's own decision with expiry

    const ownDecision = await db.getLatestCandidateDecision(candidateAccountId, jobId);
    if (ownDecision) {
      const ageMs = Date.now() - new Date(ownDecision.timestamp).getTime();
      if (ageMs > LIKE_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
        return res.json({ status: 'expired' });
      }
    }

    // TODO: Check recruiter decision from matching-decision-service
    // For now, default to waiting
    res.json({ status: 'waiting' });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load status');
    res.status(500).json({ error: 'Failed to load status' });
  }
});

export default router;
