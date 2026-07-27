import { describe, it, expect } from 'vitest';
import { classifyTransition, determineProgressionType, determineSeniorityTrend, analyzeProgression } from '../../../src/matching/careerIntelligence/progression.js';
import type { NormalizedJob, SeniorityLevel } from '../../../src/types.js';

// Enterprise AI Matching Architecture, §2.4 Career Intelligence - Module 2: Progression &
// Transition Analysis. Pure functions, no DB dependency.

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    roleProfileId: null, title: 'Backend Engineer', company: 'Acme', startDate: '2020-01', endDate: '2021-01',
    isCurrent: false, durationMonths: 12, inferredSeniority: 'mid', inferredSeniorityConfidence: 0.7, domain: 'backend_engineer',
    ...overrides,
  };
}

describe('classifyTransition', () => {
  it('classifies same domain + higher seniority as a promotion', () => {
    const from = makeJob({ inferredSeniority: 'mid' });
    const to = makeJob({ inferredSeniority: 'senior' });
    expect(classifyTransition(from, to).type).toBe('promotion');
  });

  it('classifies same domain + same seniority as a lateral move', () => {
    const from = makeJob({ inferredSeniority: 'senior', domain: 'backend_engineer' });
    const to = makeJob({ inferredSeniority: 'senior', domain: 'backend_engineer' });
    expect(classifyTransition(from, to).type).toBe('lateral_move');
  });

  it('classifies different domain + same seniority as a lateral move', () => {
    const from = makeJob({ inferredSeniority: 'senior', domain: 'backend_engineer' });
    const to = makeJob({ inferredSeniority: 'senior', domain: 'frontend_engineer' });
    expect(classifyTransition(from, to).type).toBe('lateral_move');
  });

  it('classifies different domain + seniority decrease as a domain pivot', () => {
    const from = makeJob({ inferredSeniority: 'senior', domain: 'backend_engineer' });
    const to = makeJob({ inferredSeniority: 'entry', domain: 'data_engineer' });
    expect(classifyTransition(from, to).type).toBe('domain_pivot');
  });

  it('classifies full-stack -> focused domain as specialization', () => {
    const from = makeJob({ title: 'Full-Stack Engineer', inferredSeniority: 'senior', domain: 'full_stack' });
    const to = makeJob({ title: 'Senior Frontend Engineer', inferredSeniority: 'senior', domain: 'frontend_engineer' });
    expect(classifyTransition(from, to).type).toBe('specialization');
  });

  it('classifies focused domain -> full-stack as generalization', () => {
    const from = makeJob({ title: 'Senior Frontend Engineer', inferredSeniority: 'senior', domain: 'frontend_engineer' });
    const to = makeJob({ title: 'Full-Stack Engineer', inferredSeniority: 'senior', domain: 'full_stack' });
    expect(classifyTransition(from, to).type).toBe('generalization');
  });

  it('classifies as "unknown" (never guessed) when either seniority is unresolvable', () => {
    const from = makeJob({ inferredSeniority: 'unknown' as SeniorityLevel });
    const to = makeJob({ inferredSeniority: 'senior' });
    expect(classifyTransition(from, to).type).toBe('unknown');
  });

  it('always includes a non-empty, human-readable reasoning string', () => {
    const result = classifyTransition(makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' }));
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('confidence is the minimum of the two roles\' seniority confidence, never inflated', () => {
    const from = makeJob({ inferredSeniorityConfidence: 0.4 });
    const to = makeJob({ inferredSeniority: 'senior', inferredSeniorityConfidence: 0.9 });
    expect(classifyTransition(from, to).confidence).toBe(0.4);
  });
});

describe('determineProgressionType', () => {
  it('is "ic_track" when no role is a management title', () => {
    const jobs = [makeJob({ title: 'Backend Engineer' }), makeJob({ title: 'Senior Backend Engineer' })];
    expect(determineProgressionType(jobs)).toBe('ic_track');
  });

  it('is "management_track" when every role is a management title', () => {
    const jobs = [makeJob({ title: 'Engineering Manager' }), makeJob({ title: 'Director of Engineering' })];
    expect(determineProgressionType(jobs)).toBe('management_track');
  });

  it('is "mixed" when some but not all roles are management titles', () => {
    const jobs = [makeJob({ title: 'Backend Engineer' }), makeJob({ title: 'Engineering Manager' })];
    expect(determineProgressionType(jobs)).toBe('mixed');
  });

  it('is "unclear" for an empty sequence', () => {
    expect(determineProgressionType([])).toBe('unclear');
  });
});

describe('determineSeniorityTrend', () => {
  it('is "ascending" for a monotonically increasing sequence', () => {
    const jobs = [makeJob({ inferredSeniority: 'entry' }), makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    expect(determineSeniorityTrend(jobs)).toBe('ascending');
  });

  it('is "descending" for a monotonically decreasing sequence', () => {
    const jobs = [makeJob({ inferredSeniority: 'senior' }), makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'entry' })];
    expect(determineSeniorityTrend(jobs)).toBe('descending');
  });

  it('is "stable" when every known role is the same level', () => {
    const jobs = [makeJob({ inferredSeniority: 'senior' }), makeJob({ inferredSeniority: 'senior' })];
    expect(determineSeniorityTrend(jobs)).toBe('stable');
  });

  it('is "unclear" (never forced into a label) for a non-monotonic up-and-down pattern', () => {
    const jobs = [makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' }), makeJob({ inferredSeniority: 'entry' })];
    expect(determineSeniorityTrend(jobs)).toBe('unclear');
  });

  it('is "unclear" with fewer than 2 roles with known seniority', () => {
    expect(determineSeniorityTrend([makeJob({ inferredSeniority: 'senior' })])).toBe('unclear');
    expect(determineSeniorityTrend([])).toBe('unclear');
  });
});

describe('analyzeProgression', () => {
  it('produces one transition per consecutive job pair', () => {
    const jobs = [makeJob({ inferredSeniority: 'entry' }), makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    expect(analyzeProgression(jobs).transitions).toHaveLength(2);
  });

  it('reports the seniority of the MOST RECENT (last) job as the current level', () => {
    const jobs = [makeJob({ inferredSeniority: 'mid' }), makeJob({ inferredSeniority: 'senior' })];
    expect(analyzeProgression(jobs).seniorityLevel).toBe('senior');
  });
});
