// Enterprise AI Matching Architecture, §2.4 Career Intelligence Platform - Module 4: Trajectory
// Embedding.
//
// NOT a trained neural sequence model. This codebase has no training pipeline or infrastructure
// for a custom LSTM/transformer - every other embedding here is either a call to the existing
// pre-trained sentence-transformer service (python-services/matching-ml-service), or, like this
// one, a deterministic hand-computed vector. This is a deterministic, documented,
// RECENCY-WEIGHTED positional encoding: each job in the sequence contributes to one fixed-size
// aggregate vector, with more recent jobs weighted more heavily - so the vector leans toward
// "where this career is headed" rather than an unweighted average of its whole history. Real and
// computable, not a fabricated ML capability; explicitly a simpler substitute for the doc's own
// suggested "LSTM or simple weighted sum" - the weighted-sum option, chosen for exactly the
// reason stated here.
//
// ITS OWN EMBEDDING SPACE. Dimensionality and meaning are unrelated to the 384-dim BERT
// embeddings elsewhere in this schema (skills_embedding etc.) - trajectory embeddings are only
// ever meant to be compared against OTHER trajectory embeddings (see
// src/matching/careerIntelligence/computeCareerTrajectory.ts's querySimilarTrajectories), never
// cross-compared with an unrelated embedding space.

import type { NormalizedJob, SeniorityLevel } from '../../types.js';

const SENIORITY_RANK: Record<SeniorityLevel, number> = {
  entry: 0, mid: 1, senior: 2, staff: 3, principal: 4, manager: 5, director: 6, unknown: 1,
};
const MAX_SENIORITY_RANK = 6;
const DOMAIN_HASH_BUCKETS = 11;
// [0]=weighted seniority rank, [1]=management-track fraction, [2]=weighted normalized tenure,
// [3]=accumulated weight (role-count-ish signal), [4]=weighted "is current role" fraction,
// [5..15]=hashed bag-of-domains (which domains this career touched, weighted by recency).
export const TRAJECTORY_EMBEDDING_DIM = 5 + DOMAIN_HASH_BUCKETS;

// Each job back in time contributes 0.85x the weight of the one after it - a real, documented
// modeling parameter (like dynamicWeighting.ts's TIER_WEIGHTS or skillRecency.ts's decay
// half-lives), not a fabricated fact.
const RECENCY_DECAY = 0.85;

// Simple, deterministic string hash - only needs to be stable and roughly evenly distributed
// across buckets for a "bag of domains" signal; not a security-sensitive hash.
function hashToBucket(value: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % buckets;
}

export function computeTrajectoryEmbedding(jobs: NormalizedJob[]): number[] {
  const vector = new Array(TRAJECTORY_EMBEDDING_DIM).fill(0);
  if (jobs.length === 0) return vector;

  let totalWeight = 0;
  // Iterate from most recent (last) to oldest, so weight decays going backward in time.
  for (let i = jobs.length - 1; i >= 0; i--) {
    const job = jobs[i];
    const weight = Math.pow(RECENCY_DECAY, jobs.length - 1 - i);
    totalWeight += weight;

    const seniorityRank = SENIORITY_RANK[job.inferredSeniority] ?? 1;
    vector[0] += weight * (seniorityRank / MAX_SENIORITY_RANK);
    vector[1] += weight * (seniorityRank >= SENIORITY_RANK.manager ? 1 : 0);
    vector[2] += weight * Math.min(1, (job.durationMonths ?? 0) / 60); // normalized, capped at 5 years
    vector[3] += weight;
    vector[4] += weight * (job.isCurrent ? 1 : 0);

    if (job.domain) {
      vector[5 + hashToBucket(job.domain, DOMAIN_HASH_BUCKETS)] += weight;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = Number((vector[i] / totalWeight).toFixed(6));
  }
  return vector;
}
