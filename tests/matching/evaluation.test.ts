import { describe, it, expect } from 'vitest';
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRank, averagePrecisionAtK, evaluateQueries } from '../../src/matching/evaluation.js';

// Enterprise AI Matching Architecture, Phase 3 - Evaluation Framework. Pure functions, no DB
// dependency - each takes already-ordered relevance grades. evaluateFromSwipes/
// runAndSaveEvaluation need a real DB and are covered by the integration test pass instead.

describe('ndcgAtK', () => {
  it('is 1.0 for a perfectly ordered ranking (most relevant first)', () => {
    expect(ndcgAtK([1, 0.5, 0], 3)).toBeCloseTo(1.0, 6);
  });

  it('is lower for a ranking that puts the most relevant item last', () => {
    const perfect = ndcgAtK([1, 0.5, 0], 3);
    const worst = ndcgAtK([0, 0.5, 1], 3);
    expect(worst).toBeLessThan(perfect);
  });

  it('is 0 when every relevance grade is 0 (IDCG is 0 - defined as 0, not NaN)', () => {
    expect(ndcgAtK([0, 0, 0], 3)).toBe(0);
  });

  it('only considers the top K items', () => {
    // Same top-2 order, differing only in what comes after position 2 - NDCG@2 should agree.
    const a = ndcgAtK([1, 0.5, 0, 1, 1], 2);
    const b = ndcgAtK([1, 0.5, 1, 1, 0], 2);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('precisionAtK', () => {
  it('counts a save (0.5) as relevant, same as a full accept (1)', () => {
    expect(precisionAtK([0.5, 0.5], 2)).toBe(1);
  });

  it('is (# relevant in top K) / K', () => {
    expect(precisionAtK([1, 0, 1, 0], 4)).toBe(0.5);
  });

  it('divides by the actual number of items available when fewer than K exist, not a fabricated K', () => {
    expect(precisionAtK([1], 10)).toBe(1);
  });

  it('is 0 for an empty ranking', () => {
    expect(precisionAtK([], 5)).toBe(0);
  });
});

describe('recallAtK', () => {
  it('is (# relevant in top K) / (total relevant in the full list)', () => {
    // 2 relevant total, only 1 appears in the top 2.
    expect(recallAtK([1, 0, 1], 2)).toBe(0.5);
  });

  it('is 0 when there are no relevant items at all in the full list', () => {
    expect(recallAtK([0, 0, 0], 3)).toBe(0);
  });

  it('is 1.0 when K covers the whole list', () => {
    expect(recallAtK([1, 0, 1], 3)).toBe(1);
  });
});

describe('reciprocalRank', () => {
  it('is 1.0 when the first item is relevant', () => {
    expect(reciprocalRank([1, 0, 0])).toBe(1);
  });

  it('is 1/3 when the first relevant item is at rank 3', () => {
    expect(reciprocalRank([0, 0, 1])).toBeCloseTo(1 / 3, 6);
  });

  it('is 0 when nothing is relevant', () => {
    expect(reciprocalRank([0, 0, 0])).toBe(0);
  });
});

describe('averagePrecisionAtK', () => {
  it('is 1.0 for a perfectly ordered ranking where every item is relevant', () => {
    expect(averagePrecisionAtK([1, 1, 1], 3)).toBeCloseTo(1.0, 6);
  });

  it('is 0 when there are no relevant items', () => {
    expect(averagePrecisionAtK([0, 0], 2)).toBe(0);
  });

  it('rewards relevant items appearing earlier over the same items appearing later', () => {
    const early = averagePrecisionAtK([1, 1, 0, 0], 4);
    const late = averagePrecisionAtK([0, 0, 1, 1], 4);
    expect(early).toBeGreaterThan(late);
  });
});

describe('evaluateQueries - cross-query (job) macro-averaging', () => {
  it('macro-averages across jobs, not pooling every swipe into one flat list', () => {
    // Job A: 1 swipe (perfect). Job B: 100 swipes, all worst-case. A naive micro-average would
    // be dominated by job B's volume; macro-average must weight both jobs equally.
    const jobA = { jobId: 1, rankedRelevances: [1] };
    const jobB = { jobId: 2, rankedRelevances: Array(100).fill(0) };
    const metrics = evaluateQueries([jobA, jobB], 10);
    expect(metrics.jobsEvaluated).toBe(2);
    expect(metrics.mrr).toBeCloseTo(0.5, 6); // (1 + 0) / 2, not skewed toward job B's 100 zeros
  });

  it('reports total swipes evaluated across all queries', () => {
    const metrics = evaluateQueries([{ jobId: 1, rankedRelevances: [1, 0] }, { jobId: 2, rankedRelevances: [0.5] }], 10);
    expect(metrics.swipesEvaluated).toBe(3);
  });

  it('returns all-zero metrics with jobsEvaluated=0 when there is nothing to evaluate', () => {
    const metrics = evaluateQueries([], 10);
    expect(metrics.jobsEvaluated).toBe(0);
    expect(metrics.ndcgAtK).toBe(0);
    expect(metrics.mrr).toBe(0);
  });

  it('records the k it was evaluated at', () => {
    const metrics = evaluateQueries([{ jobId: 1, rankedRelevances: [1, 0] }], 5);
    expect(metrics.k).toBe(5);
  });
});
