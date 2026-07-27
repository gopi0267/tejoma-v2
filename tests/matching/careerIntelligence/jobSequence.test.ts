import { describe, it, expect } from 'vitest';
import { inferSeniority, isManagementTitle, computeDurationMonths, SENIORITY_ORDER } from '../../../src/matching/careerIntelligence/jobSequence.js';

// Enterprise AI Matching Architecture, §2.4 Career Intelligence - Module 1: Job Sequence. Pure
// functions only - normalizeJobSequence needs findLexicalRoleMatch (DB) and is covered by the
// integration test pass instead.

describe('inferSeniority', () => {
  it('detects "senior"', () => {
    expect(inferSeniority('Senior Backend Engineer').level).toBe('senior');
  });

  it('detects "staff"', () => {
    expect(inferSeniority('Staff Software Engineer').level).toBe('staff');
  });

  it('detects "principal"', () => {
    expect(inferSeniority('Principal Engineer').level).toBe('principal');
  });

  it('detects "director"/"VP"', () => {
    expect(inferSeniority('Director of Engineering').level).toBe('director');
    expect(inferSeniority('VP of Engineering').level).toBe('director');
  });

  it('detects "manager"', () => {
    expect(inferSeniority('Engineering Manager').level).toBe('manager');
  });

  it('detects junior/entry-level keywords', () => {
    expect(inferSeniority('Junior Developer').level).toBe('entry');
    expect(inferSeniority('Software Engineering Intern').level).toBe('entry');
  });

  it('defaults a bare title with no keyword to "mid" at reduced confidence', () => {
    const result = inferSeniority('Backend Engineer');
    expect(result.level).toBe('mid');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('returns "unknown" with zero confidence for a null/empty title - never guesses', () => {
    expect(inferSeniority(null).level).toBe('unknown');
    expect(inferSeniority('').level).toBe('unknown');
    expect(inferSeniority(null).confidence).toBe(0);
  });

  it('a keyword match has higher confidence than the no-keyword default', () => {
    expect(inferSeniority('Senior Engineer').confidence).toBeGreaterThan(inferSeniority('Engineer').confidence);
  });
});

describe('isManagementTitle', () => {
  it('is true for manager/director/VP/head of/chief titles', () => {
    expect(isManagementTitle('Engineering Manager')).toBe(true);
    expect(isManagementTitle('Director of Engineering')).toBe(true);
    expect(isManagementTitle('VP Engineering')).toBe(true);
    expect(isManagementTitle('Head of Platform')).toBe(true);
    expect(isManagementTitle('Chief Technology Officer')).toBe(true);
  });

  it('is false for IC titles, including "Staff"/"Principal" (senior IC, not management)', () => {
    expect(isManagementTitle('Senior Backend Engineer')).toBe(false);
    expect(isManagementTitle('Staff Engineer')).toBe(false);
    expect(isManagementTitle('Principal Engineer')).toBe(false);
  });

  it('is false for null/empty', () => {
    expect(isManagementTitle(null)).toBe(false);
    expect(isManagementTitle('')).toBe(false);
  });
});

describe('SENIORITY_ORDER', () => {
  it('is strictly increasing in the documented rough ladder order', () => {
    expect(SENIORITY_ORDER).toEqual(['entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director']);
  });
});

describe('computeDurationMonths', () => {
  it('computes months between two "YYYY-MM" dates', () => {
    expect(computeDurationMonths('2020-01', '2021-01', false, new Date())).toBe(12);
  });

  it('uses asOf as the end date for a current role', () => {
    const asOf = new Date(Date.UTC(2026, 5, 1)); // 2026-06
    expect(computeDurationMonths('2024-06', null, true, asOf)).toBe(24);
  });

  it('returns null when start_date is missing/unparseable - never guesses', () => {
    expect(computeDurationMonths(null, '2021-01', false, new Date())).toBeNull();
    expect(computeDurationMonths('Present', '2021-01', false, new Date())).toBeNull();
  });

  it('returns null for a PAST role with no end_date - never assumes "now"', () => {
    expect(computeDurationMonths('2020-01', null, false, new Date())).toBeNull();
  });

  it('never returns a negative duration', () => {
    expect(computeDurationMonths('2022-01', '2020-01', false, new Date())).toBe(0);
  });
});
