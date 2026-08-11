/**
 * Internal, service-to-service endpoints for Candidate Service (Batch 16) - the network-boundary
 * front door for everything a candidate-facing request needs that this monolith still owns: open
 * jobs, match ranking/explanation, decisions (and their recruiter-swipe fan-out), applications,
 * and matches. Mirrors the trust model every other Tier 0 service's /internal/* already
 * documents: no JWT here, gated by network boundary (API Gateway's proxy.ts already 404s
 * /internal/* unconditionally; Candidate Service calls this directly via MONOLITH_INTERNAL_URL,
 * never through the Gateway).
 *
 * Every handler below is a thin wrapper around the EXACT db.ts/matchingApi.ts functions the
 * monolith's own src/api/candidate-jobs.routes.ts, candidate-decisions.routes.ts,
 * candidate-applications.routes.ts, and candidate-matches.routes.ts already call - same queries,
 * same validation, same fan-out (getOrCreateLinkedCandidateRow + evaluateAndCreateMutualMatch),
 * same response shapes. Nothing here is new business logic; only the entry point moved from
 * "verify a candidate JWT, read req.candidate.candidate_id" to "trust the network boundary, read
 * candidateAccountId from the request" - Candidate Service verified the JWT already, on its own
 * side, before ever making this call.
 *
 * The monolith's own candidate-*.routes.ts are UNCHANGED and continue serving real traffic
 * exactly as before - this file adds a second entry point to the same logic, it does not replace
 * the first one (strangler-fig: never remove the fallback before cutover is proven).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { rankJobsForCandidate, toSyntheticCandidateFromAccount } from '../matching/matchingApi.js';
import { computeCandidateMatchExplanation } from '../matching/explainability/computeExplanation.js';
import type { Job, CandidateAccount } from '../types.js';

const router = Router();

function parseCandidateAccountId(value: unknown): number | null {
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

// ==================== JOBS ====================

async function computeMatchScoreForViewer(candidateId: number, job: Job): Promise<number | null> {
  const account = await db.getCandidateAccountById(candidateId);
  if (!account) return null;
  const [ranked] = await rankJobsForCandidate(toSyntheticCandidateFromAccount(account), [job], { tier: 'heuristic' });
  return ranked.match_score;
}

router.get('/jobs', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (!candidateAccountId) {
      return res.status(400).json({ error: 'candidateAccountId is required' });
    }
    const { search, skill, location, company, page, pageSize } = req.query;
    const result = await db.getOpenJobsPublic({
      search: typeof search === 'string' ? search : undefined,
      skill: typeof skill === 'string' ? skill : undefined,
      location: typeof location === 'string' ? location : undefined,
      company: typeof company === 'string' ? company : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });
    const account: CandidateAccount | null = await db.getCandidateAccountById(candidateAccountId);
    let jobs: (Job & { match_score: number | null })[];
    if (account) {
      const syntheticCandidate = toSyntheticCandidateFromAccount(account);
      const ranked = await rankJobsForCandidate(syntheticCandidate, result.jobs as unknown as Job[], { tier: 'heuristic' });
      jobs = result.jobs.map((job, i) => ({ ...job, match_score: ranked[i].match_score }));
    } else {
      jobs = result.jobs.map((job) => ({ ...job, match_score: null }));
    }
    res.json({ jobs, total: result.total });
  } catch (error) {
    console.error('[internal/candidate] job discovery error:', error);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (Number.isNaN(id) || !candidateAccountId) {
      return res.status(400).json({ error: 'Invalid job id or candidateAccountId' });
    }
    const job = await db.getOpenJobByIdPublic(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const match_score = await computeMatchScoreForViewer(candidateAccountId, job as unknown as Job);
    res.json({ ...job, match_score });
  } catch (error) {
    console.error('[internal/candidate] job detail error:', error);
    res.status(500).json({ error: 'Failed to load job' });
  }
});

router.get('/jobs/:id/explanation', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (Number.isNaN(id) || !candidateAccountId) {
      return res.status(400).json({ error: 'Invalid job id or candidateAccountId' });
    }
    const job = await db.getOpenJobByIdPublic(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const account = await db.getCandidateAccountById(candidateAccountId);
    if (!account) {
      return res.status(404).json({ error: 'Candidate account not found' });
    }
    const explanation = await computeCandidateMatchExplanation(account, job as unknown as Job);
    res.json(explanation);
  } catch (error) {
    console.error('[internal/candidate] job explanation error:', error);
    res.status(500).json({ error: 'Failed to load match explanation' });
  }
});

// ==================== DECISIONS ====================

const DECISION_TO_ACTION: Record<string, number> = { swipe_right: 1, swipe_left: 0, apply: 1 };

router.post('/decisions', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.body.candidateAccountId);
    const { job_id, decision_type } = req.body;
    const jobId = parseInt(job_id, 10);
    if (!candidateAccountId || Number.isNaN(jobId) || !['swipe_right', 'swipe_left', 'apply'].includes(decision_type)) {
      return res.status(400).json({ error: 'candidateAccountId, job_id, and a valid decision_type are required' });
    }

    const job = await db.getOpenJobByIdPublic(jobId);
    if (!job) {
      return res.status(404).json({ error: 'This job is not open' });
    }

    const action = DECISION_TO_ACTION[decision_type];

    const latest = await db.getLatestCandidateDecision(candidateAccountId, jobId);
    if (latest && Number(latest.action) === action) {
      return res.status(400).json({ error: 'You have already made this decision for this job' });
    }

    const decision = await db.recordCandidateDecision({ candidateAccountId, jobId, action, decisionType: decision_type });
    if (!decision) {
      return res.status(500).json({ error: 'Failed to record decision' });
    }

    if (action === 1) {
      const companyId = await db.getJobCompanyId(jobId);
      if (companyId) {
        await db.getOrCreateLinkedCandidateRow(candidateAccountId, companyId);
        await db.evaluateAndCreateMutualMatch(candidateAccountId, jobId);
      }
    }

    res.status(201).json({ decision });
  } catch (error) {
    console.error('[internal/candidate] decision error:', error);
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

router.get('/decisions', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (!candidateAccountId) return res.status(400).json({ error: 'candidateAccountId is required' });
    const decisions = await db.getCandidateDecisions(candidateAccountId);
    res.json({ decisions });
  } catch (error) {
    console.error('[internal/candidate] decision history error:', error);
    res.status(500).json({ error: 'Failed to load decision history' });
  }
});

router.get('/decisions/active', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (!candidateAccountId) return res.status(400).json({ error: 'candidateAccountId is required' });
    const { action } = req.query;
    const parsedAction = action !== undefined ? parseInt(action as string, 10) : undefined;
    const decisions = await db.getCandidateActiveDecisions(candidateAccountId, parsedAction);
    res.json({ decisions });
  } catch (error) {
    console.error('[internal/candidate] active decisions error:', error);
    res.status(500).json({ error: 'Failed to load decisions' });
  }
});

const LIKE_EXPIRY_DAYS = 30;

router.get('/decisions/status', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    const jobId = parseInt(req.query.jobId as string, 10);
    if (!candidateAccountId || Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'candidateAccountId and jobId are required' });
    }

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
    console.error('[internal/candidate] decision status error:', error);
    res.status(500).json({ error: 'Failed to load status' });
  }
});

// ==================== APPLICATIONS ====================

router.get('/applications', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (!candidateAccountId) return res.status(400).json({ error: 'candidateAccountId is required' });
    const applications = await db.getCandidateApplications(candidateAccountId);
    res.json({ applications });
  } catch (error) {
    console.error('[internal/candidate] applications list error:', error);
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

router.get('/applications/:jobId', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    const jobId = parseInt(req.params.jobId, 10);
    if (!candidateAccountId || Number.isNaN(jobId)) {
      return res.status(400).json({ error: 'candidateAccountId and a valid jobId are required' });
    }
    const application = await db.getCandidateApplication(candidateAccountId, jobId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.json(application);
  } catch (error) {
    console.error('[internal/candidate] application detail error:', error);
    res.status(500).json({ error: 'Failed to load application' });
  }
});

// ==================== MATCHES ====================

router.get('/matches', async (req, res) => {
  try {
    const candidateAccountId = parseCandidateAccountId(req.query.candidateAccountId);
    if (!candidateAccountId) return res.status(400).json({ error: 'candidateAccountId is required' });
    const matches = await db.getCandidateMatches(candidateAccountId);
    res.json({ matches });
  } catch (error) {
    console.error('[internal/candidate] matches error:', error);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
