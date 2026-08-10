import { describe, it, expect } from 'vitest';
import { computeTopKOverlap, computeRankCorrelation } from '../../src/matching/bgeShadowRetrieval.js';

// BGE-M3 + BGE-Reranker-v2-m3 retrieval shadow comparison. Pure functions only -
// computeBgeShadowComparison needs the DB and the (usually-not-running) BGE HTTP service, and is
// covered by the integration test pass instead. None of this ever affects which candidates a
// recruiter sees or their order (see the module's own doc comment).

describe('computeTopKOverlap', () => {
  it('is 100% when both rankings agree exactly on the top-k', () => {
    const result = computeTopKOverlap([1, 2, 3], [1, 2, 3], 10);
    expect(result.count).toBe(3);
    expect(result.pct).toBe(100);
  });

  it('is 0% when the top-k sets are completely disjoint', () => {
    const result = computeTopKOverlap([1, 2, 3], [4, 5, 6], 10);
    expect(result.count).toBe(0);
    expect(result.pct).toBe(0);
  });

  it('computes real partial overlap', () => {
    const result = computeTopKOverlap([1, 2, 3, 4], [3, 4, 5, 6], 10);
    expect(result.count).toBe(2);
    expect(result.pct).toBe(50);
  });

  it('only compares within the requested k, not the full lists', () => {
    const result = computeTopKOverlap([1, 2, 3, 4, 5], [5, 4, 3, 2, 1], 2);
    // top-2 existing = {1,2}; top-2 bge = [5,4] -> no overlap within k=2
    expect(result.count).toBe(0);
  });
});

describe('computeRankCorrelation', () => {
  it('is exactly 1.0 for identical rankings', () => {
    expect(computeRankCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
  });

  it('is exactly -1.0 for perfectly reversed rankings', () => {
    expect(computeRankCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it('is null with fewer than 2 shared candidates - not enough to say anything', () => {
    expect(computeRankCorrelation([1, 2, 3], [4, 5, 6])).toBeNull();
    expect(computeRankCorrelation([1, 2, 3], [1, 5, 6])).toBeNull();
  });

  it('only considers candidates present in both rankings', () => {
    // shared = [1, 2]; both in the same relative order in each list -> perfect correlation
    // despite list 2 containing an extra candidate (5) not in list 1
    const result = computeRankCorrelation([1, 2, 3], [1, 2, 5]);
    expect(result).toBe(1);
  });
});
