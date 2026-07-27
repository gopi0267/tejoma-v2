import { describe, it, expect } from 'vitest';
import { computeSeniorityAdjustedWeights, normalizeForLexicalMatch, TIER_WEIGHTS } from '../../src/matching/dynamicWeighting.js';
import type { Job } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 2 - Dynamic Weighting Engine. Pure-function tests
// (computeSeniorityAdjustedWeights/normalizeForLexicalMatch have no DB/network dependency).
// resolveSkillTiers/computeDynamicSkillScore need a real skill graph and are covered by the
// integration test pass.

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1, company_id: 1, title: 'Backend Engineer', description: '', required_skills: [],
    experience_years: 0, location: '', salary_min: 0, salary_max: 0, status: 'open', created_at: '', updated_at: '',
    ...overrides,
  } as Job;
}

describe('computeSeniorityAdjustedWeights', () => {
  it('reduces exactly to the existing static formula when no experience requirement is stated', () => {
    const weights = computeSeniorityAdjustedWeights(makeJob({ experience_years: 0, min_experience: null }));
    expect(weights).toEqual({ skillWeight: 0.40, experienceWeight: 0.35, locationWeight: 0.15, salaryWeight: 0.10, seniorityNote: null });
  });

  it('shifts weight from skills to experience as required experience rises', () => {
    const junior = computeSeniorityAdjustedWeights(makeJob({ min_experience: 1 }));
    const senior = computeSeniorityAdjustedWeights(makeJob({ min_experience: 8 }));
    expect(senior.experienceWeight).toBeGreaterThan(junior.experienceWeight);
    expect(senior.skillWeight).toBeLessThan(junior.skillWeight);
  });

  it('never shifts more than the documented 5-percentage-point bound, even for very high experience requirements', () => {
    const weights = computeSeniorityAdjustedWeights(makeJob({ min_experience: 50 }));
    expect(weights.experienceWeight).toBeLessThanOrEqual(0.35 + 0.05 + 1e-9);
    expect(weights.skillWeight).toBeGreaterThanOrEqual(0.40 - 0.05 - 1e-9);
  });

  it('leaves location and salary weights untouched regardless of seniority', () => {
    const weights = computeSeniorityAdjustedWeights(makeJob({ min_experience: 10 }));
    expect(weights.locationWeight).toBe(0.15);
    expect(weights.salaryWeight).toBe(0.10);
  });

  it('always sums to 1.0 (no weight is silently lost or double-counted)', () => {
    for (const exp of [0, 1, 3, 5, 10, 20]) {
      const w = computeSeniorityAdjustedWeights(makeJob({ min_experience: exp }));
      expect(w.skillWeight + w.experienceWeight + w.locationWeight + w.salaryWeight).toBeCloseTo(1.0, 6);
    }
  });

  it('falls back to experience_years when min_experience is not set', () => {
    const withMin = computeSeniorityAdjustedWeights(makeJob({ min_experience: 6, experience_years: 0 }));
    const withYears = computeSeniorityAdjustedWeights(makeJob({ min_experience: undefined, experience_years: 6 }));
    expect(withMin.experienceWeight).toBe(withYears.experienceWeight);
  });

  it('produces a human-readable seniorityNote only when a shift actually occurred', () => {
    expect(computeSeniorityAdjustedWeights(makeJob({ min_experience: 0 })).seniorityNote).toBeNull();
    expect(computeSeniorityAdjustedWeights(makeJob({ min_experience: 7 })).seniorityNote).toContain('7+ yrs');
  });
});

describe('normalizeForLexicalMatch - the fix for the role-matching finding', () => {
  // matchRoleByTitle's embedding similarity matched the literal, exact title "Backend Engineer"
  // to the WRONG role ("Frontend Engineer", 0.687 similarity) during integration testing - see
  // dynamicWeighting.ts's module-level comment. Role-based tier-filling now requires this lexical
  // match to succeed; embedding similarity is not used for that decision at all. These tests cover
  // the exact case that was found broken, plus the containment case real JD titles need.

  it('normalizes case and punctuation so "Backend Engineer" and "backend-engineer!!" are equal', () => {
    expect(normalizeForLexicalMatch('Backend Engineer')).toBe(normalizeForLexicalMatch('backend-engineer!!'));
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeForLexicalMatch('Backend   Engineer')).toBe('backend engineer');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeForLexicalMatch('  Backend Engineer  ')).toBe('backend engineer');
  });

  it('supports the containment case a real JD title needs (e.g. "Senior Backend Engineer II")', () => {
    const jdTitle = normalizeForLexicalMatch('Senior Backend Engineer II');
    const roleName = normalizeForLexicalMatch('Backend Engineer');
    expect(jdTitle.includes(roleName)).toBe(true);
  });

  it('does NOT match an unrelated role by containment (the exact failure mode that was found)', () => {
    const jdTitle = normalizeForLexicalMatch('Backend Engineer');
    const roleName = normalizeForLexicalMatch('Frontend Engineer');
    expect(jdTitle.includes(roleName)).toBe(false);
    expect(jdTitle === roleName).toBe(false);
  });
});

describe('TIER_WEIGHTS', () => {
  it('sums to 1.0 and is strictly decreasing from mandatory to bonus', () => {
    const sum = TIER_WEIGHTS.mandatory + TIER_WEIGHTS.preferred + TIER_WEIGHTS.optional + TIER_WEIGHTS.bonus;
    expect(sum).toBeCloseTo(1.0, 6);
    expect(TIER_WEIGHTS.mandatory).toBeGreaterThan(TIER_WEIGHTS.preferred);
    expect(TIER_WEIGHTS.preferred).toBeGreaterThan(TIER_WEIGHTS.optional);
    expect(TIER_WEIGHTS.optional).toBeGreaterThan(TIER_WEIGHTS.bonus);
  });
});
