import { describe, it, expect } from 'vitest';
import { extractExperience, extractSalary, extractNoticePeriod, extractNumberOfOpenings, extractEmploymentType, extractRemoteType } from '../../src/jd-parser/tiers/regexTier.js';

describe('extractExperience', () => {
  it('parses an exact number', () => {
    expect(extractExperience('5 Years of experience required.')).toEqual({ minimumExperience: 5, maximumExperience: 5, experienceUnit: 'years' });
  });

  it('parses an open-ended plus range', () => {
    expect(extractExperience('5+ Years of experience.')).toEqual({ minimumExperience: 5, maximumExperience: null, experienceUnit: 'years' });
  });

  it('parses a dash range', () => {
    expect(extractExperience('5-8 Years experience needed.')).toEqual({ minimumExperience: 5, maximumExperience: 8, experienceUnit: 'years' });
  });

  it('parses "minimum N years"', () => {
    expect(extractExperience('Minimum 5 Years of relevant experience.')).toEqual({ minimumExperience: 5, maximumExperience: null, experienceUnit: 'years' });
  });

  it('parses "at least N years"', () => {
    expect(extractExperience('At least 4 Years in a similar role.')).toEqual({ minimumExperience: 4, maximumExperience: null, experienceUnit: 'years' });
  });

  it('parses "N to M years"', () => {
    expect(extractExperience('3 to 6 Years of hands-on experience.')).toEqual({ minimumExperience: 3, maximumExperience: 6, experienceUnit: 'years' });
  });

  it('parses months as a distinct unit', () => {
    expect(extractExperience('6+ months of internship experience.')).toEqual({ minimumExperience: 6, maximumExperience: null, experienceUnit: 'months' });
  });

  it('returns all-null when no experience is mentioned', () => {
    expect(extractExperience('We are a great place to work.')).toEqual({ minimumExperience: null, maximumExperience: null, experienceUnit: null });
  });
});

describe('extractSalary', () => {
  it('parses single LPA', () => {
    expect(extractSalary('12 LPA')).toEqual({ salaryMinimum: 1200000, salaryMaximum: 1200000, salaryCurrency: 'INR' });
  });

  it('parses LPA range', () => {
    expect(extractSalary('10-15 LPA')).toEqual({ salaryMinimum: 1000000, salaryMaximum: 1500000, salaryCurrency: 'INR' });
  });

  it('parses rupee-symbol Lakhs', () => {
    expect(extractSalary('₹18 Lakhs')).toEqual({ salaryMinimum: 1800000, salaryMaximum: 1800000, salaryCurrency: 'INR' });
  });

  it('parses plain USD', () => {
    expect(extractSalary('USD 120000')).toEqual({ salaryMinimum: 120000, salaryMaximum: 120000, salaryCurrency: 'USD' });
  });

  it('parses $ with K suffix', () => {
    expect(extractSalary('$80K')).toEqual({ salaryMinimum: 80000, salaryMaximum: 80000, salaryCurrency: 'USD' });
  });

  it('parses a USD range with K suffixes', () => {
    expect(extractSalary('USD 90K - 130K')).toEqual({ salaryMinimum: 90000, salaryMaximum: 130000, salaryCurrency: 'USD' });
  });

  it('returns all-null when no salary is mentioned', () => {
    expect(extractSalary('Great benefits and culture.')).toEqual({ salaryMinimum: null, salaryMaximum: null, salaryCurrency: null });
  });
});

describe('extractNoticePeriod', () => {
  it('parses a labeled duration', () => {
    expect(extractNoticePeriod('Notice Period: 30 days')).toBe('30 days');
  });

  it('recognizes immediate joiners', () => {
    expect(extractNoticePeriod('Immediate joiners preferred')).toBe('Immediate');
  });

  it('returns null when absent', () => {
    expect(extractNoticePeriod('No mention of notice here.')).toBeNull();
  });
});

describe('extractNumberOfOpenings', () => {
  it('parses "N openings"', () => {
    expect(extractNumberOfOpenings('3 openings available')).toBe(3);
  });

  it('parses "Openings: N"', () => {
    expect(extractNumberOfOpenings('Openings: 5')).toBe(5);
  });

  it('returns null when absent', () => {
    expect(extractNumberOfOpenings('No openings mentioned.')).toBeNull();
  });
});

describe('extractEmploymentType', () => {
  it('detects full-time', () => {
    expect(extractEmploymentType('This is a full-time position')).toBe('full-time');
  });

  it('detects contract-to-hire as contract', () => {
    expect(extractEmploymentType('Contract to hire role')).toBe('contract');
  });

  it('detects internship', () => {
    expect(extractEmploymentType('Summer internship opportunity')).toBe('internship');
  });

  it('returns null when absent', () => {
    expect(extractEmploymentType('Great team culture.')).toBeNull();
  });
});

describe('extractRemoteType', () => {
  it('prioritizes hybrid over onsite when both words appear', () => {
    expect(extractRemoteType('This is a hybrid role, 3 days onsite')).toBe('hybrid');
  });

  it('detects fully remote', () => {
    expect(extractRemoteType('Fully remote position')).toBe('remote');
  });

  it('detects onsite when nothing else is mentioned', () => {
    expect(extractRemoteType('This is an onsite role')).toBe('onsite');
  });

  it('returns null when absent', () => {
    expect(extractRemoteType('Great benefits.')).toBeNull();
  });
});
