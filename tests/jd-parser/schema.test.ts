import { describe, it, expect } from 'vitest';
import { validateAndNormalize, JobDescriptionValidationError } from '../../src/jd-parser/schema.js';
import type { ParsedJobDescription } from '../../src/jd-parser/types.js';

function baseValid(): ParsedJobDescription {
  return {
    jobTitle: 'Senior Backend Engineer',
    requiredSkills: [{ canonical: 'Node.js', category: 'backend_framework', matchedText: 'Node.js' }],
    optionalSkills: [],
    minimumExperience: 5,
    maximumExperience: 8,
    experienceUnit: 'years',
    location: ['Bangalore'],
    remoteType: 'hybrid',
    employmentType: 'full-time',
    industry: null,
    department: null,
    education: [],
    certifications: [],
    salaryMinimum: 1000000,
    salaryMaximum: 1500000,
    salaryCurrency: 'INR',
    noticePeriod: '30 days',
    numberOfOpenings: 3,
    requiredLanguages: [],
    responsibilities: [],
    requiredTools: [],
    requiredTechnologies: [],
    requiredFrameworks: [],
    requiredDatabases: [],
    requiredCloudPlatforms: [],
    requiredMethodologies: [],
    keywords: ['Node.js'],
    jobSummary: 'A great role.',
  };
}

describe('validateAndNormalize', () => {
  it('accepts a fully valid, fully populated result', () => {
    expect(() => validateAndNormalize(baseValid())).not.toThrow();
  });

  it('accepts an all-null/empty result (nothing extracted, never hallucinated)', () => {
    const empty: ParsedJobDescription = {
      ...baseValid(),
      jobTitle: null,
      requiredSkills: [],
      minimumExperience: null,
      maximumExperience: null,
      experienceUnit: null,
      location: [],
      remoteType: null,
      employmentType: null,
      salaryMinimum: null,
      salaryMaximum: null,
      salaryCurrency: null,
      noticePeriod: null,
      numberOfOpenings: null,
      keywords: [],
      jobSummary: null,
    };
    expect(() => validateAndNormalize(empty)).not.toThrow();
  });

  it('rejects minimumExperience greater than maximumExperience', () => {
    const bad = { ...baseValid(), minimumExperience: 10, maximumExperience: 5 };
    expect(() => validateAndNormalize(bad)).toThrow(JobDescriptionValidationError);
  });

  it('rejects salaryMinimum greater than salaryMaximum', () => {
    const bad = { ...baseValid(), salaryMinimum: 2000000, salaryMaximum: 1000000 };
    expect(() => validateAndNormalize(bad)).toThrow(JobDescriptionValidationError);
  });

  it('rejects an invalid experienceUnit enum value', () => {
    const bad = { ...baseValid(), experienceUnit: 'decades' };
    expect(() => validateAndNormalize(bad)).toThrow(JobDescriptionValidationError);
  });

  it('rejects an invalid employmentType enum value', () => {
    const bad = { ...baseValid(), employmentType: 'gig' };
    expect(() => validateAndNormalize(bad)).toThrow(JobDescriptionValidationError);
  });

  it('rejects a negative experience value', () => {
    const bad = { ...baseValid(), minimumExperience: -1 };
    expect(() => validateAndNormalize(bad)).toThrow(JobDescriptionValidationError);
  });

  it('throws with field-level issues attached', () => {
    const bad = { ...baseValid(), minimumExperience: 10, maximumExperience: 5 };
    try {
      validateAndNormalize(bad);
      expect.fail('expected validateAndNormalize to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(JobDescriptionValidationError);
      expect((err as JobDescriptionValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
