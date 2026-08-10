/**
 * Internal endpoints wrapping this service's ported matching/matchingApi.ts (the "Unified
 * Matching API" orchestration layer - ranking, sorting, and match_scores/match_features
 * write-through persistence), distinct from scoring.routes.ts's raw calculateMatchScoresBatch
 * wrappers. Network-boundary trusted, no JWT - same convention as every other /internal/* route.
 *
 * Callers (job-service - Step 4; candidate-service, for candidate-search.routes.ts's real
 * cutover - Step 5; matching-decision-service - Step 6, as each is cut over in later steps of the
 * remaining-monolith migration) pass the exact same job/candidates/options shape the monolith's
 * own route handlers already build today, and get back the exact same RankedCandidate[]/
 * RankedJob[]/MatchScoreResult shape their monolith equivalents already return. (Earlier drafts of
 * this comment named candidate-core-service as candidate-search.routes.ts's destination - real
 * inspection in Step 5 found its actual bounded context, candidate_accounts, is owned by
 * candidate-service instead; corrected here.)
 */
import { Router } from 'express';
import { rankCandidatesForJob, rankJobsForCandidate, scoreCandidateForJob, toSyntheticCandidateFromAccount, toSyntheticJobFromQuery, type MatchTier } from '../matching/matchingApi.js';
import type { ActiveModelType } from '../matching/services.js';
import type { Candidate, Job, CandidateAccount } from '../types.js';

const router = Router();

const VALID_TIERS: MatchTier[] = ['heuristic', 'full'];
const VALID_MODEL_TYPES: ActiveModelType[] = ['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'];

function resolveTier(input: unknown): MatchTier | null {
  return typeof input === 'string' && (VALID_TIERS as string[]).includes(input) ? (input as MatchTier) : null;
}

function resolveModelType(input: unknown): ActiveModelType | undefined {
  return typeof input === 'string' && (VALID_MODEL_TYPES as string[]).includes(input) ? (input as ActiveModelType) : undefined;
}

router.post('/rank-candidates-for-job', async (req, res) => {
  try {
    const { job, candidates, tier, modelType, persist } = req.body as {
      job: Job;
      candidates: Candidate[];
      tier: string;
      modelType?: string;
      persist?: { companyId: number; source?: string };
    };
    const resolvedTier = resolveTier(tier);
    if (!job || !Array.isArray(candidates) || !resolvedTier) {
      return res.status(400).json({ error: 'job, candidates[], and a valid tier are required' });
    }

    const ranked = await rankCandidatesForJob(job, candidates, { tier: resolvedTier, modelType: resolveModelType(modelType), persist });
    res.json({ ranked });
  } catch (error) {
    console.error('[internal] rank-candidates-for-job error:', error);
    res.status(500).json({ error: 'Failed to rank candidates for job' });
  }
});

router.post('/rank-jobs-for-candidate', async (req, res) => {
  try {
    const { candidate, jobs, tier, modelType } = req.body as { candidate: Candidate; jobs: Job[]; tier: string; modelType?: string };
    const resolvedTier = resolveTier(tier);
    if (!candidate || !Array.isArray(jobs) || !resolvedTier) {
      return res.status(400).json({ error: 'candidate, jobs[], and a valid tier are required' });
    }

    const ranked = await rankJobsForCandidate(candidate, jobs, { tier: resolvedTier, modelType: resolveModelType(modelType) });
    res.json({ ranked });
  } catch (error) {
    console.error('[internal] rank-jobs-for-candidate error:', error);
    res.status(500).json({ error: 'Failed to rank jobs for candidate' });
  }
});

router.post('/score-candidate-for-job', async (req, res) => {
  try {
    const { job, candidate, modelType } = req.body as { job: Job; candidate: Candidate; modelType?: string };
    if (!job || !candidate) {
      return res.status(400).json({ error: 'job and candidate are required' });
    }

    const score = await scoreCandidateForJob(job, candidate, { modelType: resolveModelType(modelType) });
    res.json({ score });
  } catch (error) {
    console.error('[internal] score-candidate-for-job error:', error);
    res.status(500).json({ error: 'Failed to score candidate for job' });
  }
});

// Stateless adapters - exposed so a future caller building a synthetic Candidate/Job doesn't need
// to reimplement this trivial mapping itself over HTTP. In practice, Step 5's candidate-service
// ported these two pure, dependency-free functions directly into candidateSearch.routes.ts instead
// of calling this endpoint - a network round-trip for a one-line object transform isn't worth it;
// only rankCandidatesForJob's real ranking work goes over the wire. Left exposed here regardless,
// unchanged, for any future caller that does want a shared implementation.
router.post('/synthetic-candidate-from-account', (req, res) => {
  const account = req.body as CandidateAccount;
  res.json({ candidate: toSyntheticCandidateFromAccount(account) });
});

router.post('/synthetic-job-from-query', (req, res) => {
  const filters = req.body as { skills?: string[]; location?: string; jobTitle?: string; q?: string; minExperience?: number };
  res.json({ job: toSyntheticJobFromQuery(filters) });
});

export default router;
