/**
 * Ported from the monolith's src/matching/matchingApi.ts - the "Unified Matching API" used by
 * every real scoring surface (recruiter candidate search, candidate job discovery, recruiter
 * swipe queue, job-detail view). Two real deviations from the original, both scope reductions for
 * dead code, confirmed via a repo-wide grep before cutting anything:
 *
 *   1. `weighting: 'dynamic'` (dynamicWeighting.ts's role/tier-aware skill scoring) is NOT
 *      ported - `grep -rn "weighting: 'dynamic'" src/` returns zero hits anywhere in the
 *      monolith. The monolith's own module doc already documents this as strictly opt-in with no
 *      real caller; porting a whole role_profiles/skill_nodes/skill_edges cross-service read
 *      chain for code nothing calls would be pure speculative work.
 *   2. `retrieval` (hybridRetrieveCandidates pre-ranking) is likewise NOT ported -
 *      dynamic-weighting-service's own retrieval.ts header comment already confirms
 *      `grep -rn "retrieval: {" src` returns zero hits too.
 *
 * Every other real call site's real usage (tier: 'heuristic' | 'full', skipGeminiSummary, persist)
 * is preserved exactly. `modelType` is new here (not in the original) - this service's own ported
 * services.ts takes it as an explicit per-request parameter rather than a shared module value
 * (see services.ts's own header comment for why) - callers pass it the same way the monolith's own
 * shadow client already does.
 */
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import type { Candidate, Job, CandidateAccount, MatchScore } from '../types.js';
import { computeMatchFeatures, computeFeatureScore, calculateMatchScoresBatch, calculateMatchScoresForJobsBatch, type MatchScoreResult, type ActiveModelType } from './services.js';
import { persistMatchFeatures } from './featureStore.js';

export type MatchTier = 'heuristic' | 'full';
export type MatchWeighting = 'static' | 'dynamic';

export interface RankedCandidate {
  candidate: Candidate;
  match_score: number;
  score?: MatchScoreResult;
}

export interface RankedJob {
  job: Job;
  match_score: number;
  score?: MatchScoreResult;
}

export interface RankCandidatesOptions {
  tier: MatchTier;
  modelType?: ActiveModelType;
  /** Only meaningful with tier: 'full' and real candidates/jobs rows. */
  persist?: {
    companyId: number;
    source?: string;
  };
}

export interface RankJobsOptions {
  tier: MatchTier;
  modelType?: ActiveModelType;
}

const DEFAULT_MODEL_TYPE: ActiveModelType = 'random_forest';

// ==================== SYNTHETIC OBJECT ADAPTERS ====================
// Byte-identical to the monolith's own copy.

export function toSyntheticCandidateFromAccount(c: CandidateAccount): Candidate {
  return {
    skills: c.skills || [],
    years_of_experience: c.years_of_experience,
    current_location: c.location,
    current_job_title: c.headline,
    resume_text: c.summary,
  } as unknown as Candidate;
}

export function toSyntheticJobFromQuery(filters: {
  skills?: string[];
  location?: string;
  jobTitle?: string;
  q?: string;
  minExperience?: number;
}): Job {
  return {
    required_skills: filters.skills || [],
    location: filters.location || '',
    title: filters.jobTitle || filters.q || '',
    description: filters.q || '',
    experience_years: filters.minExperience || 0,
  } as unknown as Job;
}

// ==================== UNIFIED ENTRY POINTS ====================

export async function rankCandidatesForJob(job: Job, candidates: Candidate[], options: RankCandidatesOptions): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];

  if (options.tier === 'heuristic') {
    return candidates.map((candidate) => {
      const features = computeMatchFeatures(job, candidate);
      return { candidate, match_score: computeFeatureScore(features) };
    });
  }

  const modelType = options.modelType ?? DEFAULT_MODEL_TYPE;
  const scores = await calculateMatchScoresBatch(job, candidates, modelType);
  const ranked: RankedCandidate[] = candidates.map((candidate, i) => ({
    candidate,
    match_score: scores[i].final_score,
    score: scores[i],
  }));
  ranked.sort((a, b) => b.match_score - a.match_score);

  if (options.persist) {
    try {
      await persistCandidateMatchScores(options.persist.companyId, job, ranked);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'match_scores persistence failed');
    }

    try {
      await persistMatchFeatures({
        companyId: options.persist.companyId,
        job,
        weighting: 'static',
        tier: options.tier,
        modelVersion: modelType,
        source: options.persist.source ?? 'unified_matching_api',
        entries: ranked.map((r) => ({ candidateId: r.candidate.id, score: r.score })),
      });
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'match_features persistence failed');
    }
  }

  return ranked;
}

export async function scoreCandidateForJob(job: Job, candidate: Candidate, options?: { modelType?: ActiveModelType }): Promise<MatchScoreResult> {
  const [ranked] = await rankCandidatesForJob(job, [candidate], { tier: 'full', modelType: options?.modelType });
  return ranked.score!;
}

export async function rankJobsForCandidate(candidate: Candidate, jobs: Job[], options: RankJobsOptions): Promise<RankedJob[]> {
  if (jobs.length === 0) return [];

  if (options.tier === 'heuristic') {
    return jobs.map((job) => {
      const features = computeMatchFeatures(job, candidate);
      return { job, match_score: computeFeatureScore(features) };
    });
  }

  const modelType = options.modelType ?? DEFAULT_MODEL_TYPE;
  const scores = await calculateMatchScoresForJobsBatch(candidate, jobs, modelType);
  return jobs.map((job, i) => ({ job, match_score: scores[i].final_score, score: scores[i] }));
}

// ==================== MATCH_SCORES WRITE-THROUGH PERSISTENCE ====================

async function persistCandidateMatchScores(companyId: number, job: Job, ranked: RankedCandidate[]): Promise<void> {
  if (!job.id) return;

  const writes = ranked.map((entry, i) => {
    if (!entry.candidate.id || !entry.score) return Promise.resolve(null);
    const record: Omit<MatchScore, 'id' | 'created_at'> = {
      company_id: companyId,
      job_id: job.id,
      candidate_id: entry.candidate.id,
      feature_score: entry.score.feature_score,
      embedding_score: entry.score.embedding_score,
      ml_score: entry.score.ml_score,
      final_score: entry.score.final_score,
      rank: i + 1,
    };
    return db.saveMatchScore(record);
  });

  await Promise.allSettled(writes);
}
