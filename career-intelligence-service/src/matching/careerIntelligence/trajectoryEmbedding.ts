// Ported from the monolith's src/matching/careerIntelligence/trajectoryEmbedding.ts -
// byte-identical logic. A deterministic, recency-weighted positional encoding, in its OWN
// embedding space - only ever compared against other trajectory embeddings (see
// computeCareerTrajectory.ts's querySimilarTrajectories), never cross-compared with an unrelated
// embedding space.

import type { NormalizedJob, SeniorityLevel } from '../../types.js';

const SENIORITY_RANK: Record<SeniorityLevel, number> = {
  entry: 0, mid: 1, senior: 2, staff: 3, principal: 4, manager: 5, director: 6, unknown: 1,
};
const MAX_SENIORITY_RANK = 6;
const DOMAIN_HASH_BUCKETS = 11;
export const TRAJECTORY_EMBEDDING_DIM = 5 + DOMAIN_HASH_BUCKETS;

const RECENCY_DECAY = 0.85;

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
  for (let i = jobs.length - 1; i >= 0; i--) {
    const job = jobs[i];
    const weight = Math.pow(RECENCY_DECAY, jobs.length - 1 - i);
    totalWeight += weight;

    const seniorityRank = SENIORITY_RANK[job.inferredSeniority] ?? 1;
    vector[0] += weight * (seniorityRank / MAX_SENIORITY_RANK);
    vector[1] += weight * (seniorityRank >= SENIORITY_RANK.manager ? 1 : 0);
    vector[2] += weight * Math.min(1, (job.durationMonths ?? 0) / 60);
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
