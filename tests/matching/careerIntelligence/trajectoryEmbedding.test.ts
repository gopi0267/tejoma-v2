import { describe, it, expect } from 'vitest';
import { computeTrajectoryEmbedding, TRAJECTORY_EMBEDDING_DIM } from '../../../src/matching/careerIntelligence/trajectoryEmbedding.js';
import { cosineSimilarity } from '../../../src/utils/embeddings.js';
import type { NormalizedJob } from '../../../src/types.js';

// Enterprise AI Matching Architecture, §2.4 Career Intelligence - Module 4: Trajectory Embedding.
// Pure, deterministic - not a trained model, see the module's own doc comment.

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    roleProfileId: null, title: 'Backend Engineer', company: 'Acme', startDate: '2020-01', endDate: '2021-01',
    isCurrent: false, durationMonths: 12, inferredSeniority: 'mid', inferredSeniorityConfidence: 0.7, domain: 'backend_engineer',
    ...overrides,
  };
}

describe('computeTrajectoryEmbedding', () => {
  it('returns a zero vector of the documented dimensionality for an empty sequence', () => {
    const vector = computeTrajectoryEmbedding([]);
    expect(vector).toHaveLength(TRAJECTORY_EMBEDDING_DIM);
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  it('is deterministic - the same input always produces the same output', () => {
    const jobs = [makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    expect(computeTrajectoryEmbedding(jobs)).toEqual(computeTrajectoryEmbedding(jobs));
  });

  it('two identical trajectories are maximally similar (cosine ~1.0)', () => {
    const jobsA = [makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    const jobsB = [makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    const similarity = cosineSimilarity(computeTrajectoryEmbedding(jobsA), computeTrajectoryEmbedding(jobsB));
    expect(similarity).toBeCloseTo(1.0, 4);
  });

  it('a consistently ascending IC trajectory is more similar to another ascending IC trajectory than to a flat management one', () => {
    const ascendingIC = [makeJob({ title: 'Backend Engineer', inferredSeniority: 'entry', domain: 'backend_engineer' }), makeJob({ title: 'Senior Backend Engineer', inferredSeniority: 'senior', domain: 'backend_engineer' })];
    const anotherAscendingIC = [makeJob({ title: 'Frontend Engineer', inferredSeniority: 'entry', domain: 'frontend_engineer' }), makeJob({ title: 'Senior Frontend Engineer', inferredSeniority: 'senior', domain: 'frontend_engineer' })];
    const flatManagement = [makeJob({ title: 'Engineering Manager', inferredSeniority: 'manager', domain: 'engineering_manager' }), makeJob({ title: 'Engineering Manager', inferredSeniority: 'manager', domain: 'engineering_manager' })];

    const simSameTrackShape = cosineSimilarity(computeTrajectoryEmbedding(ascendingIC), computeTrajectoryEmbedding(anotherAscendingIC));
    const simDifferentTrack = cosineSimilarity(computeTrajectoryEmbedding(ascendingIC), computeTrajectoryEmbedding(flatManagement));
    expect(simSameTrackShape).toBeGreaterThan(simDifferentTrack);
  });

  it('weights more recent jobs more heavily than older ones (recency-weighted, not a flat average)', () => {
    // Two trajectories that differ only in WHICH job is most recent - the current-seniority
    // signal (dim 0) should differ meaningfully between them.
    const risingRecently = [makeJob({ inferredSeniority: 'senior' }), makeJob({ inferredSeniority: 'director' })];
    const fallingRecently = [makeJob({ inferredSeniority: 'director' }), makeJob({ inferredSeniority: 'senior' })];
    const a = computeTrajectoryEmbedding(risingRecently);
    const b = computeTrajectoryEmbedding(fallingRecently);
    expect(a[0]).toBeGreaterThan(b[0]); // ending on "director" should weight seniority higher than ending on "senior"
  });
});
