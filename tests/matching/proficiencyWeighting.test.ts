import { describe, it, expect } from 'vitest';
import { calculateProficiencyMultiplier, combineSkillMultipliers, DEFAULT_EXPECTED_TIER } from '../../src/matching/proficiencyWeighting.js';

// Enterprise AI Matching Architecture, Phase 11 - Proficiency Weighting, SHADOW MODE ONLY. Pure
// functions only - computeProficiencyShadowResult needs the DB and is covered by the
// integration test pass instead. Every test here is about the SHADOW calculation; none of this
// is ever applied to a live match score (see proficiencyWeighting.ts's module doc).

describe('calculateProficiencyMultiplier', () => {
  it('defaults the expectation to intermediate - the only real fallback (no per-skill job data exists)', () => {
    expect(DEFAULT_EXPECTED_TIER).toBe('intermediate');
  });

  it('boosts when candidate proficiency exceeds the expectation, at full confidence', () => {
    const result = calculateProficiencyMultiplier('expert', 1.0, 'intermediate');
    expect(result.matchType).toBe('exceeds');
    expect(result.multiplier).toBeCloseTo(1.2, 4); // 2 tiers above * 0.10
  });

  it('penalizes when candidate proficiency is below the expectation, at full confidence', () => {
    const result = calculateProficiencyMultiplier('beginner', 1.0, 'intermediate');
    expect(result.matchType).toBe('below');
    expect(result.multiplier).toBeCloseTo(0.85, 4); // 1 tier below * 0.15
  });

  it('is exactly neutral when tiers match, regardless of confidence', () => {
    expect(calculateProficiencyMultiplier('intermediate', 1.0).multiplier).toBe(1);
    expect(calculateProficiencyMultiplier('intermediate', 0.3).multiplier).toBe(1);
  });

  it('is exactly neutral (1.0) at zero confidence - same as "unknown", never guesses', () => {
    const result = calculateProficiencyMultiplier('expert', 0, 'intermediate');
    expect(result.multiplier).toBe(1);
  });

  it('interpolates linearly toward neutral as confidence drops', () => {
    const full = calculateProficiencyMultiplier('expert', 1.0, 'intermediate').multiplier;
    const half = calculateProficiencyMultiplier('expert', 0.5, 'intermediate').multiplier;
    expect(half).toBeCloseTo(1 + (full - 1) * 0.5, 4);
  });

  it('caps the boost at 1.30 even for an extreme tier gap', () => {
    const result = calculateProficiencyMultiplier('expert', 1.0, 'beginner'); // 3 tiers above
    expect(result.multiplier).toBeLessThanOrEqual(1.3);
  });

  it('floors the penalty at 0.50 even for an extreme tier gap', () => {
    const result = calculateProficiencyMultiplier('beginner', 1.0, 'expert'); // 3 tiers below
    expect(result.multiplier).toBeGreaterThanOrEqual(0.5);
  });
});

describe('combineSkillMultipliers', () => {
  it('is neutral (1.0) for an empty list - never fabricates an effect from nothing', () => {
    expect(combineSkillMultipliers([])).toBe(1);
  });

  it('returns the same value for a single-skill list', () => {
    expect(combineSkillMultipliers([1.2])).toBeCloseTo(1.2, 4);
  });

  it('combines multiple multipliers via geometric mean, not arithmetic mean', () => {
    // geometric mean of 1.2 and 0.8 is sqrt(0.96) ~= 0.9798, NOT the arithmetic mean 1.0
    const combined = combineSkillMultipliers([1.2, 0.8]);
    expect(combined).toBeCloseTo(Math.sqrt(1.2 * 0.8), 4);
    expect(combined).not.toBeCloseTo(1.0, 2);
  });
});
