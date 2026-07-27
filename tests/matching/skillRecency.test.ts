import { describe, it, expect } from 'vitest';
import { parseResumeDate, recencyMultiplier, computeSkillRecencyFromProjects, CATEGORY_DECAY_HALF_LIFE_YEARS } from '../../src/matching/skillRecency.js';
import type { ProjectEntry } from '../../src/types.js';

// Enterprise AI Matching Architecture, §2.2 - Skill Recency & Evolution. Pure functions, no DB
// dependency - computeCandidateSkillRecency needs canonicalizeSkill (DB) and is covered by the
// integration test pass instead.

function makeProject(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return { name: 'Test Project', description: '', technologies: [], start_date: null, end_date: null, ...overrides };
}

describe('parseResumeDate', () => {
  it('parses "YYYY-MM"', () => {
    const d = parseResumeDate('2021-06');
    expect(d?.getUTCFullYear()).toBe(2021);
    expect(d?.getUTCMonth()).toBe(5); // 0-indexed
  });

  it('parses "YYYY" (year-only)', () => {
    const d = parseResumeDate('2019');
    expect(d?.getUTCFullYear()).toBe(2019);
  });

  it('returns null for null/undefined/empty', () => {
    expect(parseResumeDate(null)).toBeNull();
    expect(parseResumeDate(undefined)).toBeNull();
    expect(parseResumeDate('')).toBeNull();
  });

  it('returns null for a malformed date rather than guessing', () => {
    expect(parseResumeDate('Present')).toBeNull();
    expect(parseResumeDate('June 2021')).toBeNull();
    expect(parseResumeDate('2021-13')).toBeNull(); // invalid month
  });
});

describe('recencyMultiplier', () => {
  it('is 1.0 at zero years elapsed', () => {
    expect(recencyMultiplier(0, 'ai_ml')).toBe(1);
  });

  it('is 0.5 at exactly one half-life', () => {
    const halfLife = CATEGORY_DECAY_HALF_LIFE_YEARS.database;
    expect(recencyMultiplier(halfLife, 'database')).toBeCloseTo(0.5, 6);
  });

  it('decays faster for a fast-moving category than a stable one, over the same elapsed time', () => {
    const fast = recencyMultiplier(2, 'ai_ml');
    const slow = recencyMultiplier(2, 'methodology');
    expect(fast).toBeLessThan(slow);
  });

  it('approaches but never reaches 0, even after a very long time', () => {
    const multiplier = recencyMultiplier(50, 'ai_ml');
    expect(multiplier).toBeGreaterThan(0);
    expect(multiplier).toBeLessThan(0.01);
  });

  it('falls back to a middling default half-life for an unrecognized/null category', () => {
    const withNull = recencyMultiplier(4, null);
    const withUnknownCategory = recencyMultiplier(4, 'not_a_real_category');
    expect(withNull).toBe(withUnknownCategory);
  });
});

describe('computeSkillRecencyFromProjects', () => {
  const asOf = new Date(Date.UTC(2026, 0, 1)); // fixed "now" for deterministic tests

  it('returns confidence "unknown" and a neutral 1.0 multiplier when the skill appears in no project', () => {
    const result = computeSkillRecencyFromProjects('Rust', [makeProject({ technologies: ['Python'] })], 'programming_language', asOf);
    expect(result.confidence).toBe('unknown');
    expect(result.recencyMultiplier).toBe(1.0);
    expect(result.lastUsed).toBeNull();
  });

  it('returns confidence "unknown" when the skill appears in a project but that project has no usable date', () => {
    const result = computeSkillRecencyFromProjects('Python', [makeProject({ technologies: ['Python'] })], 'programming_language', asOf);
    expect(result.confidence).toBe('unknown');
    expect(result.totalMentions).toBe(1); // still counted as a mention, just an undated one
  });

  it('computes real years-since-last-used from a dated project', () => {
    const result = computeSkillRecencyFromProjects(
      'Python',
      [makeProject({ technologies: ['Python'], end_date: '2024-01' })],
      'programming_language',
      asOf
    );
    expect(result.confidence).toBe('known');
    expect(result.yearsSinceLastUsed).toBeCloseTo(2, 0);
    expect(result.lastUsed).toBe('2024-01');
  });

  it('uses the MOST RECENT dated project when the skill appears in several', () => {
    const result = computeSkillRecencyFromProjects(
      'Python',
      [
        makeProject({ name: 'Old', technologies: ['Python'], end_date: '2018-01' }),
        makeProject({ name: 'New', technologies: ['Python'], end_date: '2025-06' }),
      ],
      'programming_language',
      asOf
    );
    expect(result.lastUsed).toBe('2025-06');
  });

  it('is case-insensitive when matching the skill against a project\'s technologies', () => {
    const result = computeSkillRecencyFromProjects('python', [makeProject({ technologies: ['PYTHON'], end_date: '2024-01' })], 'programming_language', asOf);
    expect(result.confidence).toBe('known');
  });

  it('falls back to start_date when a project has no end_date at all', () => {
    const result = computeSkillRecencyFromProjects('Python', [makeProject({ technologies: ['Python'], start_date: '2023-01', end_date: null })], 'programming_language', asOf);
    expect(result.confidence).toBe('known');
    expect(result.lastUsed).toBe('2023-01');
  });

  it('counts total mentions across both dated and undated projects', () => {
    const result = computeSkillRecencyFromProjects(
      'Python',
      [
        makeProject({ technologies: ['Python'] }), // undated
        makeProject({ technologies: ['Python'], end_date: '2023-01' }),
      ],
      'programming_language',
      asOf
    );
    expect(result.totalMentions).toBe(2);
  });
});
