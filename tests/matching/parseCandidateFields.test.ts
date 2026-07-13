import { describe, it, expect } from 'vitest';
import { parseExperienceYears, parseSalaryValue, resolveCandidateSalaryExpectation } from '../../src/matching/parseCandidateFields.js';

describe('parseExperienceYears', () => {
  it('parses a plain number with "years" suffix', () => {
    expect(parseExperienceYears('6 years')).toBe(6);
  });

  it('parses an open-ended "6+ years"', () => {
    expect(parseExperienceYears('6+ years')).toBe(6);
  });

  it('parses a range, taking the lower bound', () => {
    expect(parseExperienceYears('5-8 years')).toBe(5);
  });

  it('parses a decimal value', () => {
    expect(parseExperienceYears('3.10 years')).toBe(3.1);
  });

  it('returns 0 for missing/empty input (never crashes, never returns NaN)', () => {
    expect(parseExperienceYears(null)).toBe(0);
    expect(parseExperienceYears(undefined)).toBe(0);
    expect(parseExperienceYears('')).toBe(0);
  });

  it('returns 0 when no number is present at all', () => {
    expect(parseExperienceYears('Not specified')).toBe(0);
  });
});

describe('parseSalaryValue', () => {
  it('parses a single LPA value', () => {
    expect(parseSalaryValue('12 LPA')).toBe(1200000);
  });

  it('averages a range', () => {
    expect(parseSalaryValue('10-15 LPA')).toBe(1250000);
  });

  it('parses a USD value', () => {
    expect(parseSalaryValue('$80K')).toBe(80000);
  });

  it('returns null for missing/unparseable input', () => {
    expect(parseSalaryValue(null)).toBeNull();
    expect(parseSalaryValue('')).toBeNull();
    expect(parseSalaryValue('Negotiable')).toBeNull();
  });
});

describe('resolveCandidateSalaryExpectation', () => {
  it('prefers expected_ctc over current_ctc', () => {
    const result = resolveCandidateSalaryExpectation({ expected_ctc: '20 LPA', current_ctc: '15 LPA' });
    expect(result).toBe(2000000);
  });

  it('falls back to current_ctc when expected_ctc is missing', () => {
    const result = resolveCandidateSalaryExpectation({ expected_ctc: null, current_ctc: '15 LPA' });
    expect(result).toBe(1500000);
  });

  it('returns null when neither field is parseable (never a fake default like the old phantom salary_expectation field)', () => {
    const result = resolveCandidateSalaryExpectation({ expected_ctc: null, current_ctc: null });
    expect(result).toBeNull();
  });
});
