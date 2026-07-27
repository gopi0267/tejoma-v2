import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { rankJobsForCandidate, toSyntheticCandidateFromAccount } from '../matching/matchingApi.js';
import type { Job, CandidateAccount } from '../types.js';

const router = Router();

// Both routes gated by requireCandidateAuth (per-route, not router.use() - see
// candidate-profile.routes.ts's comment for why a blanket gate here would be wrong once this
// router sits ahead of jobRouter in src/api/index.ts). db.getOpenJobsPublic/getOpenJobByIdPublic
// use an explicit column allowlist, so visibility rules are enforced at the query layer, not
// just by what the frontend chooses to render.

// Enterprise AI Matching Architecture, Phase 0: routed through the Unified Matching API's
// rankJobsForCandidate/toSyntheticCandidateFromAccount instead of this file's own (previously
// near-duplicated, byte-for-byte identical to candidate-search.routes.ts's copy)
// toSyntheticCandidate(). tier: 'heuristic' preserves this endpoint's exact existing scoring
// behavior - no ML ensemble, no embeddings - unchanged from before this refactor. See
// matchingApi.ts's module doc for why upgrading this to the full pipeline is deliberately
// deferred, not done as a side effect of unifying the code path.
async function computeMatchScoreForViewer(candidateId: number, job: Job): Promise<number | null> {
  const account = await db.getCandidateAccountById(candidateId);
  if (!account) return null;
  const [ranked] = await rankJobsForCandidate(toSyntheticCandidateFromAccount(account), [job], { tier: 'heuristic' });
  return ranked.match_score;
}

// ==================== BROWSE / SEARCH OPEN JOBS ====================
router.get('/candidate-jobs', requireCandidateAuth, async (req, res) => {
  try {
    const { search, skill, location, company, page, pageSize } = req.query;
    const result = await db.getOpenJobsPublic({
      search: typeof search === 'string' ? search : undefined,
      skill: typeof skill === 'string' ? skill : undefined,
      location: typeof location === 'string' ? location : undefined,
      company: typeof company === 'string' ? company : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });
    const account: CandidateAccount | null = await db.getCandidateAccountById(req.candidate!.candidate_id);
    let jobs: (Job & { match_score: number | null })[];
    if (account) {
      const syntheticCandidate = toSyntheticCandidateFromAccount(account);
      const ranked = await rankJobsForCandidate(syntheticCandidate, result.jobs as unknown as Job[], { tier: 'heuristic' });
      // No sort applied - matches this endpoint's exact pre-existing behavior (it has never
      // ranked by match_score, only by whatever order db.getOpenJobsPublic returned).
      jobs = result.jobs.map((job, i) => ({ ...job, match_score: ranked[i].match_score }));
    } else {
      jobs = result.jobs.map((job) => ({ ...job, match_score: null }));
    }
    res.json({ jobs, total: result.total });
  } catch (error) {
    console.error('Candidate job discovery error:', error);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// ==================== JOB DETAIL ====================
router.get('/candidate-jobs/:id', requireCandidateAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const job = await db.getOpenJobByIdPublic(id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const match_score = await computeMatchScoreForViewer(req.candidate!.candidate_id, job as unknown as Job);
    res.json({ ...job, match_score });
  } catch (error) {
    console.error('Candidate job detail error:', error);
    res.status(500).json({ error: 'Failed to load job' });
  }
});

export default router;
