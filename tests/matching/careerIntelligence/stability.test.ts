import { describe, it, expect } from 'vitest';
import { computeTenureStats, findEmploymentGaps, analyzeDomainBreakdown } from '../../../src/matching/careerIntelligence/stability.js';
import type { NormalizedJob } from '../../../src/types.js';

// Enterprise AI Matching Architecture, §2.4 Career Intelligence - Module 3: Stability & Domain
// Analysis. Fairness-critical: gaps must be facts only (dates + duration), never annotated with
// an inferred cause - see this module's own doc comment.

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    roleProfileId: null, title: 'Backend Engineer', company: 'Acme', startDate: '2020-01', endDate: '2021-01',
    isCurrent: false, durationMonths: 12, inferredSeniority: 'mid', inferredSeniorityConfidence: 0.7, domain: 'backend_engineer',
    ...overrides,
  };
}

describe('computeTenureStats', () => {
  it('computes average and median tenure in months', () => {
    const jobs = [makeJob({ durationMonths: 12 }), makeJob({ durationMonths: 24 }), makeJob({ durationMonths: 36 })];
    const stats = computeTenureStats(jobs);
    expect(stats.avgTenureMonths).toBe(24);
    expect(stats.medianTenureMonths).toBe(24);
  });

  it('labels "short" when every role is under 12 months', () => {
    const jobs = [makeJob({ durationMonths: 4 }), makeJob({ durationMonths: 8 })];
    expect(computeTenureStats(jobs).tenurePattern).toBe('short');
  });

  it('labels "stable" when every role is 24+ months', () => {
    const jobs = [makeJob({ durationMonths: 30 }), makeJob({ durationMonths: 48 })];
    expect(computeTenureStats(jobs).tenurePattern).toBe('stable');
  });

  it('labels "variable" for a mixed pattern', () => {
    const jobs = [makeJob({ durationMonths: 4 }), makeJob({ durationMonths: 36 })];
    expect(computeTenureStats(jobs).tenurePattern).toBe('variable');
  });

  it('is "unclear" with no dated roles at all - never guesses a pattern from nothing', () => {
    const jobs = [makeJob({ durationMonths: null })];
    const stats = computeTenureStats(jobs);
    expect(stats.tenurePattern).toBe('unclear');
    expect(stats.avgTenureMonths).toBeNull();
  });
});

describe('findEmploymentGaps', () => {
  const asOf = new Date(Date.UTC(2026, 0, 1));

  it('detects a real gap between two dated, non-overlapping roles', () => {
    const jobs = [
      makeJob({ startDate: '2018-01', endDate: '2019-01', isCurrent: false }),
      makeJob({ startDate: '2019-09', endDate: '2020-09', isCurrent: false }),
    ];
    const gaps = findEmploymentGaps(jobs, asOf);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMonths).toBe(8);
  });

  it('records ONLY start date, end date, and duration - no other fields (fairness: facts only)', () => {
    const jobs = [
      makeJob({ startDate: '2018-01', endDate: '2019-01', isCurrent: false }),
      makeJob({ startDate: '2019-09', endDate: '2020-09', isCurrent: false }),
    ];
    const gap = findEmploymentGaps(jobs, asOf)[0];
    expect(Object.keys(gap).sort()).toEqual(['durationMonths', 'endDate', 'startDate']);
  });

  it('does not report a gap for back-to-back roles with no real space between them', () => {
    const jobs = [
      makeJob({ startDate: '2018-01', endDate: '2019-01', isCurrent: false }),
      makeJob({ startDate: '2019-01', endDate: '2020-01', isCurrent: false }),
    ];
    expect(findEmploymentGaps(jobs, asOf)).toHaveLength(0);
  });

  it('never fabricates a gap when either boundary date is unparseable', () => {
    const jobs = [
      makeJob({ startDate: '2018-01', endDate: null, isCurrent: false }), // no end date - unknown, not "still gap-free"
      makeJob({ startDate: '2020-01', endDate: '2021-01', isCurrent: false }),
    ];
    expect(findEmploymentGaps(jobs, asOf)).toHaveLength(0);
  });
});

describe('analyzeDomainBreakdown', () => {
  it('computes domain concentration as the top domain\'s share of total dated months', () => {
    const jobs = [
      makeJob({ domain: 'backend_engineer', durationMonths: 24 }),
      makeJob({ domain: 'backend_engineer', durationMonths: 24 }),
      makeJob({ domain: 'devops_engineer', durationMonths: 12 }),
    ];
    const { domainConcentration, domains } = analyzeDomainBreakdown(jobs);
    expect(domainConcentration).toBeCloseTo(48 / 60, 4);
    expect(domains[0].domain).toBe('backend_engineer');
  });

  it('is 1.0 when every role is the same domain', () => {
    const jobs = [makeJob({ domain: 'backend_engineer', durationMonths: 12 }), makeJob({ domain: 'backend_engineer', durationMonths: 12 })];
    expect(analyzeDomainBreakdown(jobs).domainConcentration).toBe(1);
  });

  it('is null with no domain-resolvable, dated roles at all', () => {
    const jobs = [makeJob({ domain: null, durationMonths: 12 })];
    expect(analyzeDomainBreakdown(jobs).domainConcentration).toBeNull();
  });

  it('sorts domains by total months descending', () => {
    const jobs = [
      makeJob({ domain: 'devops_engineer', durationMonths: 6 }),
      makeJob({ domain: 'backend_engineer', durationMonths: 30 }),
    ];
    const { domains } = analyzeDomainBreakdown(jobs);
    expect(domains[0].domain).toBe('backend_engineer');
  });
});
