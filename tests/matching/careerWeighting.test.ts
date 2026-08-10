import { describe, it, expect } from 'vitest';
import { computeProgressionSignal, computeStabilitySignal, computeDomainSignal, combineCareerSignals } from '../../src/matching/careerWeighting.js';

// Enterprise AI Matching Architecture, Phase 12 - Career Trajectory Weighting, SHADOW MODE ONLY.
// Pure functions only - computeCareerShadowResult needs the DB and is covered by the
// integration test pass instead. None of this ever affects a live match score (see the
// module's own doc comment).

describe('computeProgressionSignal', () => {
  it('boosts an ic_track candidate above the job level, plus an ascending-trend bonus', () => {
    const signal = computeProgressionSignal('ic_track', 'staff', 'senior', 'ascending', false);
    // track: (staff=3 - senior=2) * 0.12 = 0.12; trend: ascending = +0.08 => 0.20
    expect(signal).toBeCloseTo(0.2, 4);
  });

  it('penalizes an ic_track candidate below the job level, plus a descending-trend penalty', () => {
    const signal = computeProgressionSignal('ic_track', 'mid', 'senior', 'descending', false);
    // track: (mid=1 - senior=2) * 0.12 = -0.12; trend: descending = -0.15 => -0.27, capped combination not applied to sum
    expect(signal).toBeCloseTo(-0.27, 4);
  });

  it('applies the off-track penalty for a management-track candidate on an IC job', () => {
    const signal = computeProgressionSignal('management_track', 'manager', 'senior', 'stable', false);
    expect(signal).toBeCloseTo(-0.15, 4);
  });

  it('applies the off-track penalty symmetrically for an ic_track candidate on a management job (documented extension)', () => {
    const signal = computeProgressionSignal('ic_track', 'staff', 'manager', 'stable', true);
    expect(signal).toBeCloseTo(-0.15, 4);
  });

  it('applies the flat mixed-track penalty', () => {
    const signal = computeProgressionSignal('mixed', 'senior', 'senior', 'stable', false);
    expect(signal).toBeCloseTo(-0.1, 4);
  });

  it('never guesses for an unclear/null progression type - signal is trend-only', () => {
    expect(computeProgressionSignal('unclear', 'senior', 'senior', 'stable', false)).toBe(0);
    expect(computeProgressionSignal(null, 'senior', 'senior', 'ascending', false)).toBeCloseTo(0.08, 4);
  });

  it('never guesses a track-level signal when either seniority level is unresolved', () => {
    const signal = computeProgressionSignal('ic_track', null, 'senior', 'stable', false);
    expect(signal).toBe(0);
  });
});

describe('computeStabilitySignal', () => {
  it('is neutral for a stable pattern with no gaps', () => {
    expect(computeStabilitySignal('stable', [])).toBe(1);
  });

  it('penalizes a short tenure pattern', () => {
    expect(computeStabilitySignal('short', [])).toBeCloseTo(0.8, 4);
  });

  it('applies a mild penalty for a gap under the long-gap threshold', () => {
    const signal = computeStabilitySignal('stable', [{ startDate: '2020-01', endDate: '2020-10', durationMonths: 9 }]);
    expect(signal).toBeCloseTo(0.95, 4);
  });

  it('applies a stronger penalty for a gap at/above the long-gap threshold', () => {
    const signal = computeStabilitySignal('stable', [{ startDate: '2020-01', endDate: '2022-06', durationMonths: 29 }]);
    expect(signal).toBeCloseTo(0.85, 4);
  });

  it('uses the longest gap, not the sum, when there are multiple', () => {
    const signal = computeStabilitySignal('stable', [
      { startDate: '2018-01', endDate: '2018-07', durationMonths: 6 },
      { startDate: '2020-01', endDate: '2020-10', durationMonths: 9 },
    ]);
    expect(signal).toBeCloseTo(0.95, 4); // longest gap is 9mo, well under the 24mo threshold
  });

  it('defaults an unclear/null tenure pattern to neutral - never guesses', () => {
    expect(computeStabilitySignal('unclear', null)).toBe(1);
    expect(computeStabilitySignal(null, null)).toBe(1);
  });
});

describe('computeDomainSignal', () => {
  it('boosts high domain concentration matching the job domain', () => {
    const signal = computeDomainSignal(0.85, 'backend_engineer', 'backend_engineer');
    expect(signal).toBeCloseTo(1.1 * 1.05, 4);
  });

  it('penalizes scattered concentration with a domain pivot', () => {
    const signal = computeDomainSignal(0.3, 'backend_engineer', 'frontend_engineer');
    expect(signal).toBeCloseTo(0.85 * 0.95, 4);
  });

  it('is neutral on the match component when either domain is unresolved - never penalizes missing data', () => {
    const signal = computeDomainSignal(0.85, null, 'backend_engineer');
    expect(signal).toBeCloseTo(1.1, 4);
  });

  it('is fully neutral (1.0) when concentration itself is unknown', () => {
    expect(computeDomainSignal(null, null, null)).toBe(1);
  });
});

describe('combineCareerSignals', () => {
  it('is exactly neutral (1.0) at zero confidence, regardless of the raw signals', () => {
    const multiplier = combineCareerSignals(0.2, 1.2, 1.1, 0);
    expect(multiplier).toBe(1);
  });

  it('applies the full raw effect at full confidence', () => {
    const multiplier = combineCareerSignals(0.2, 1.0, 1.0, 1.0);
    expect(multiplier).toBeCloseTo(1.2, 4);
  });

  it('respects the overall multiplier cap [0.60, 1.35] before confidence blending', () => {
    const boosted = combineCareerSignals(0.25, 1.1, 1.1, 1.0);
    expect(boosted).toBeLessThanOrEqual(1.35);
    const penalized = combineCareerSignals(-0.25, 0.8, 0.85, 1.0);
    expect(penalized).toBeGreaterThanOrEqual(0.6);
  });
});
