import { describe, it, expect } from 'vitest';
import { rawRecencyMultiplier, roleRecencyExpectation, applyRoleAdjustment, calculateSkillRecencyMultiplier } from '../../src/matching/recencyWeighting.js';

// Enterprise AI Matching Architecture, Phase 13 - Skill Recency Weighting, SHADOW MODE ONLY.
// Pure functions only - computeRecencyShadowResult needs the DB and is covered by the
// integration test pass instead. None of this ever affects a live match score (see the
// module's own doc comment).

describe('rawRecencyMultiplier', () => {
  it('boosts a skill used very recently, decaying toward neutral as it approaches 6 months', () => {
    const fresh = rawRecencyMultiplier(0, 0.15, 0.2);
    const almostNeutral = rawRecencyMultiplier(3, 0.15, 0.2);
    expect(fresh).toBeCloseTo(1.075, 4);
    expect(almostNeutral).toBeCloseTo(1.0375, 4);
    expect(fresh).toBeGreaterThan(almostNeutral);
  });

  it('is exactly neutral across the whole 6-36 month "current" band', () => {
    expect(rawRecencyMultiplier(6, 0.15, 0.2)).toBe(1);
    expect(rawRecencyMultiplier(20, 0.15, 0.2)).toBe(1);
    expect(rawRecencyMultiplier(36, 0.15, 0.2)).toBe(1);
  });

  it('decays past 36 months, matching the spec\'s own internally-consistent worked example', () => {
    // spec: 48mo with decay=0.25 -> 0.875; using decay=0.2 here scales the same arithmetic
    expect(rawRecencyMultiplier(48, 0.15, 0.2)).toBeCloseTo(0.9, 4);
    expect(rawRecencyMultiplier(60, 0.15, 0.2)).toBeCloseTo(0.8, 4);
  });

  it('continues decaying past 60 months rather than jumping to a separate floor table', () => {
    const at60 = rawRecencyMultiplier(60, 0.15, 0.2);
    const at84 = rawRecencyMultiplier(84, 0.15, 0.2);
    expect(at84).toBeLessThan(at60);
  });
});

describe('roleRecencyExpectation', () => {
  it('maps real fast-moving role keys to high', () => {
    expect(roleRecencyExpectation('frontend_engineer')).toBe('high');
    expect(roleRecencyExpectation('devops_engineer')).toBe('high');
  });

  it('maps real stable role keys to low', () => {
    expect(roleRecencyExpectation('backend_engineer')).toBe('low');
    expect(roleRecencyExpectation('data_engineer')).toBe('low');
  });

  it('defaults to medium for an unresolved or unlisted role - never guesses', () => {
    expect(roleRecencyExpectation(null)).toBe('medium');
    expect(roleRecencyExpectation('product_manager')).toBe('medium');
  });
});

describe('applyRoleAdjustment', () => {
  it('applies the extra penalty only to an already-decaying skill in a high-expectation role', () => {
    const adjusted = applyRoleAdjustment(0.9, 'high');
    expect(adjusted).toBeCloseTo(0.72, 4);
  });

  it('never touches a boosted (fresh) skill, regardless of role expectation', () => {
    expect(applyRoleAdjustment(1.075, 'high')).toBe(1.075);
  });

  it('never adjusts for medium/low expectation roles', () => {
    expect(applyRoleAdjustment(0.9, 'medium')).toBe(0.9);
    expect(applyRoleAdjustment(0.9, 'low')).toBe(0.9);
  });
});

describe('calculateSkillRecencyMultiplier', () => {
  it('is exactly neutral with low confidence when the usage date is unknown', () => {
    const result = calculateSkillRecencyMultiplier(null, 'frontend_framework', 0.5, 'medium');
    expect(result.multiplier).toBe(1);
    expect(result.reasoning).toContain('unknown');
  });

  it('derives a bigger swing for a fast-decaying category than a slow one, at the same age', () => {
    // ai_ml has a short half-life (1.5yr); methodology has a long one (6yr) - see
    // CATEGORY_DECAY_HALF_LIFE_YEARS. At the same "old" age, ai_ml should decay further.
    const aiMl = calculateSkillRecencyMultiplier(60, 'ai_ml', 1.0, 'medium');
    const methodology = calculateSkillRecencyMultiplier(60, 'methodology', 1.0, 'medium');
    expect(aiMl.multiplier).toBeLessThan(methodology.multiplier);
  });

  it('is exactly neutral (1.0) at zero confidence, regardless of the raw signal', () => {
    const result = calculateSkillRecencyMultiplier(60, 'ai_ml', 0, 'medium');
    expect(result.multiplier).toBe(1);
  });

  it('respects the global multiplier cap [0.60, 1.20]', () => {
    const veryOld = calculateSkillRecencyMultiplier(240, 'ai_ml', 1.0, 'high');
    const veryFresh = calculateSkillRecencyMultiplier(0, 'ai_ml', 1.0, 'medium');
    expect(veryOld.multiplier).toBeGreaterThanOrEqual(0.6);
    expect(veryFresh.multiplier).toBeLessThanOrEqual(1.2);
  });
});
