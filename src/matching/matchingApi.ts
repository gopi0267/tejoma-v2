// Enterprise AI Matching Architecture, Phase 0 - "Unified Matching API across all four surfaces"
// (recruiter candidate search, candidate job discovery, recruiter swipe queue, job-detail view).
//
// Before this module, every surface called its own scoring path directly:
//   - job.routes.ts (GET /jobs/:id) and swipe.routes.ts called calculateMatchScoresBatch from
//     services.ts directly - the full heuristic + BERT-embedding + ML-ensemble pipeline.
//   - candidate-search.routes.ts and candidate-jobs.routes.ts each had their OWN, near-identical
//     copy of a toSyntheticCandidate() adapter, and called computeMatchFeatures/
//     computeFeatureScore directly - heuristic only, no embeddings, no ML ensemble.
//
// This module is the single place all four now go through. It does NOT change what any surface
// currently returns to its users: recruiter surfaces keep getting the exact full-pipeline scoring
// they already had (tier: 'full'), candidate-facing surfaces keep getting the exact heuristic-only
// scoring they already had (tier: 'heuristic'). What changes is that the two near-duplicate
// synthetic-object adapters are now one shared implementation, and the code path recruiter-side
// scoring runs through is now reusable by the candidate-facing surfaces the moment a validated
// decision is made to upgrade their tier - a config change at the call site, not a rewrite.
//
// Persistence (match_scores write-through logging) is deliberately restricted to the 'full' tier
// working with real `candidates`/`jobs` rows - match_scores.candidate_id has a hard foreign key
// to candidates(id), which synthetic candidate_accounts-derived objects can never satisfy, so
// candidate-search/candidate-jobs never attempt to persist.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import type { Candidate, Job, CandidateAccount, MatchScore } from '../types.js';
import {
  computeMatchFeatures,
  computeFeatureScore,
  calculateMatchScoresBatch,
  calculateMatchScoresForJobsBatch,
  calculateDynamicMatchScoresBatch,
  MatchScoreResult,
} from '../services.js';
import { hybridRetrieveCandidates, type VectorSearchProvider } from './retrieval.js';
import { persistMatchFeatures } from './featureStore.js';
import { activeModelType } from '../services.js';

export type MatchTier = 'heuristic' | 'full';
// Enterprise AI Matching Architecture, Phase 2 - 'static' is the existing computeFeatureScore
// formula (0.40/0.35/0.15/0.10), used by every call site that doesn't explicitly pass 'dynamic'.
// This is the validation-safe rollback path: removing (or never adding) `weighting: 'dynamic'` at
// any call site is a complete, instant, one-line rollback to today's exact scoring - no other
// code changes anywhere. Only honored when tier: 'full' (dynamic weighting's role/tier resolution
// is a "full pipeline" concern, like the ML ensemble it sits alongside); silently ignored at
// tier: 'heuristic', which stays exactly as fast and simple as it already is.
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

export interface HybridRetrievalRequest {
  /** Narrows the candidate pool via src/matching/retrieval.ts's 3-strategy RRF fusion before scoring. */
  enabled: true;
  limit?: number;
  provider?: VectorSearchProvider;
}

export interface RankCandidatesOptions {
  tier: MatchTier;
  weighting?: MatchWeighting;
  skipGeminiSummary?: boolean;
  /** Only meaningful with tier: 'full' and real candidates/jobs rows - see module doc above. */
  persist?: {
    companyId: number;
    // Enterprise AI Matching Architecture, Phase 3 - which of the four Unified Matching API
    // surfaces this call came from, recorded on every match_features row this call produces
    // (see src/matching/featureStore.ts). Optional/defaulted so every pre-Phase-3 call site
    // keeps compiling and persisting match_scores exactly as before without change.
    source?: string;
  };
  /** Opt-in hybrid retrieval pre-ranking (see src/matching/retrieval.ts). Omit for today's exact behavior. */
  retrieval?: HybridRetrievalRequest;
}

export interface RankJobsOptions {
  tier: MatchTier;
  skipGeminiSummary?: boolean;
}

// ==================== SYNTHETIC OBJECT ADAPTERS ====================
// Deduplicated from candidate-search.routes.ts and candidate-jobs.routes.ts, which each carried
// their own copy of an identical toSyntheticCandidate(). Behavior is unchanged from both originals
// - fields with no home on candidate_accounts (resume_embedding, salary, etc.) are simply left
// undefined, which computeMatchFeatures/calculateMatchScoresBatch already handle gracefully (e.g.
// salScore defaults to a neutral 100 when no salary data is present; the BERT similarity falls
// back to bag-of-words cosine when an embedding is missing).

export function toSyntheticCandidateFromAccount(c: CandidateAccount): Candidate {
  return {
    skills: c.skills || [],
    years_of_experience: c.years_of_experience,
    current_location: c.location,
    current_job_title: c.headline,
    resume_text: c.summary,
  } as unknown as Candidate;
}

// Moved from candidate-search.routes.ts, unchanged - builds a synthetic "query as job" object so
// the existing job-vs-candidate ranking math can be reused for query-vs-candidate ranking.
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

// "Rank candidates for a job" - the shape used by recruiter candidate search (synthetic job,
// synthetic candidates), recruiter swipe queue, and job-detail view (real job, real candidates).
export async function rankCandidatesForJob(
  job: Job,
  candidates: Candidate[],
  options: RankCandidatesOptions
): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];

  // Enterprise AI Matching Architecture, Phase 2 - opt-in only (options.retrieval is undefined
  // for every existing call site). Re-ranks/narrows the pool via 3-strategy RRF fusion before
  // scoring runs; when omitted, `candidates` flows into scoring exactly as passed in, byte-for-
  // byte identical to pre-Phase-2 behavior.
  const pool = options.retrieval
    ? (await hybridRetrieveCandidates(job, candidates, { limit: options.retrieval.limit, provider: options.retrieval.provider })).map((r) => r.candidate)
    : candidates;

  if (options.tier === 'heuristic') {
    // Identical to what candidate-search.routes.ts did inline before this module existed -
    // computeMatchFeatures/computeFeatureScore, no ML ensemble, no embeddings. Sort order is left
    // to the caller (candidate-search sorts after calling this; other heuristic-tier callers may
    // not need to, matching their exact pre-existing behavior).
    return pool.map((candidate) => {
      const features = computeMatchFeatures(job, candidate);
      return { candidate, match_score: computeFeatureScore(features) };
    });
  }

  const scores = options.weighting === 'dynamic'
    ? await calculateDynamicMatchScoresBatch(job, pool)
    : await calculateMatchScoresBatch(job, pool, { skipGeminiSummary: options.skipGeminiSummary });
  const ranked: RankedCandidate[] = pool.map((candidate, i) => ({
    candidate,
    match_score: scores[i].final_score,
    score: scores[i],
  }));
  ranked.sort((a, b) => b.match_score - a.match_score);

  if (options.persist) {
    // Awaited, not fire-and-forget: saveMatchScore is a single fast, indexed INSERT (not a slow
    // external call like the resume-file-upload pattern elsewhere in this codebase), and the
    // whole point of activating match_scores this phase is to build a *reliable* historical
    // record for the Feature Store / Feedback Learning phases that depend on it later - a
    // best-effort write that silently races the response would undermine that. Wrapped in its
    // own try/catch so a persistence failure still can never fail or delay the match response
    // itself; it only means this one call's scores won't be logged.
    try {
      await persistCandidateMatchScores(options.persist.companyId, job, ranked);
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'match_scores persistence failed');
    }

    // Enterprise AI Matching Architecture, Phase 3 - Feature Store. Same awaited, own-try/catch
    // discipline as match_scores above: never fails or delays the match response itself, and a
    // write failure here only means this call's feature vectors won't be logged.
    try {
      await persistMatchFeatures({
        companyId: options.persist.companyId,
        job,
        weighting: options.weighting ?? 'static',
        tier: options.tier,
        modelVersion: activeModelType,
        source: options.persist.source ?? 'unified_matching_api',
        entries: ranked.map((r) => ({ candidateId: r.candidate.id, score: r.score })),
      });
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'match_features persistence failed');
    }
  }

  return ranked;
}

// "Rank jobs for a candidate" - the shape used by candidate job discovery (real jobs, synthetic
// candidate).
export async function rankJobsForCandidate(
  candidate: Candidate,
  jobs: Job[],
  options: RankJobsOptions
): Promise<RankedJob[]> {
  if (jobs.length === 0) return [];

  if (options.tier === 'heuristic') {
    // Identical to what candidate-jobs.routes.ts did inline before this module existed. No sort
    // applied here either, matching candidate-jobs.routes.ts's existing behavior exactly (its
    // job-list endpoint has never sorted by match_score - see the Phase 0 implementation report
    // for why that pre-existing gap is intentionally left untouched in this phase).
    return jobs.map((job) => {
      const features = computeMatchFeatures(job, candidate);
      return { job, match_score: computeFeatureScore(features) };
    });
  }

  const scores = await calculateMatchScoresForJobsBatch(candidate, jobs, { skipGeminiSummary: options.skipGeminiSummary });
  return jobs.map((job, i) => ({ job, match_score: scores[i].final_score, score: scores[i] }));
}

// ==================== MATCH_SCORES WRITE-THROUGH PERSISTENCE ====================
// Activates the previously-dead match_scores table (getMatchScores/saveMatchScore existed in
// db.ts with zero call sites anywhere). Write-only for this phase: every 'full'-tier score
// computed against real candidates/jobs rows is now durably logged, building the historical
// record later phases (Feature Store, Feedback Learning) depend on - but nothing yet reads this
// table back to skip a computation. Read-through caching is deferred until cache invalidation on
// profile/job edits is explicitly designed; serving a stale score would be a real behavior change
// this phase is not authorized to make.
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
      rank: i + 1, // ranked[] is already sorted by match_score descending at this point
    };
    return db.saveMatchScore(record);
  });

  await Promise.allSettled(writes);
}
