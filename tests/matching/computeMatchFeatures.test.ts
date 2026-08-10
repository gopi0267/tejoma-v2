import { describe, it, expect } from 'vitest';
import { computeMatchFeatures } from '../../src/matching/services.js';
import type { Candidate, Job } from '../../src/types.js';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1, name: 'Test Candidate', email: 't@test.com', phone: '', skills: ['Node.js', 'PostgreSQL'],
    primary_skills: '', secondary_skills: '', years_of_experience: '5 years', current_location: 'Hyderabad',
    preferred_location: '', current_company: '', previous_companies: [], current_job_title: 'Backend Engineer',
    industry_domain: '', education: '', highest_qualification: '', graduation_year: '', university: '',
    certifications: [], projects: '', technical_tools: '', languages_known: '', current_ctc: '',
    expected_ctc: '', notice_period: '', willingness_to_relocate: '', linkedin_url: '', github_or_portfolio_url: '',
    resume_summary: '', resume_text: '', ai_confidence_score: '',
    ...overrides,
  } as Candidate;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1, company_id: 1, title: 'Backend Engineer', description: 'Backend role needing Node.js and PostgreSQL.',
    required_skills: ['Node.js', 'PostgreSQL'], experience_years: 4, location: 'Hyderabad',
    salary_min: 1000000, salary_max: 1800000, status: 'open', created_at: '', updated_at: '',
    ...overrides,
  } as Job;
}

describe('computeMatchFeatures - regression tests for 3 fixed bugs', () => {
  it('BUG FIX #1: correctly parses years_of_experience as text, not silently zero via a `typeof === number` check', () => {
    const f = computeMatchFeatures(makeJob({ experience_years: 3 }), makeCandidate({ years_of_experience: '6+ years' }));
    expect(f.candidateExp).toBe(6);
    expect(f.expScore).toBe(100); // 6 >= 3 required
  });

  it('BUG FIX #2: uses expected_ctc/current_ctc, not a nonexistent salary_expectation field defaulting to 100000', () => {
    const f = computeMatchFeatures(
      makeJob({ salary_min: 1000000, salary_max: 1500000 }),
      makeCandidate({ expected_ctc: '20 LPA' }) // 2,000,000 - above the job's max
    );
    expect(f.candidateSalary).toBe(2000000);
    expect(f.salScore).toBeLessThan(100); // correctly penalized for exceeding the range
  });

  it('BUG FIX #2b: does not fabricate a salary expectation when none is stated (old code defaulted to 100000)', () => {
    const f = computeMatchFeatures(makeJob(), makeCandidate({ expected_ctc: '', current_ctc: '' }));
    expect(f.candidateSalary).toBeNull();
    expect(f.salScore).toBe(100); // neutral, not penalized for missing data
  });

  it('BUG FIX #3: computes real geographic distance instead of a hardcoded 4-city matrix', () => {
    const f = computeMatchFeatures(
      makeJob({ location: 'San Francisco, CA' }),
      makeCandidate({ current_location: 'Austin, TX' })
    );
    expect(f.locDist).toBeGreaterThan(2000);
    expect(f.locDist).toBeLessThan(2800);
    expect(f.locScore).toBeLessThan(100);
  });

  it('BUG FIX #3b: works for city pairs the old hardcoded matrix never covered at all (e.g. Indian cities)', () => {
    const f = computeMatchFeatures(
      makeJob({ location: 'Bangalore' }),
      makeCandidate({ current_location: 'Hyderabad' })
    );
    expect(f.locDist).toBeGreaterThan(400);
    expect(f.locDist).toBeLessThan(650);
  });

  it('gives a perfect location score for an exact city match', () => {
    const f = computeMatchFeatures(makeJob({ location: 'Hyderabad' }), makeCandidate({ current_location: 'Hyderabad' }));
    expect(f.locDist).toBe(0);
    expect(f.locScore).toBe(100);
  });

  it('computes Jaccard skill overlap correctly', () => {
    const f = computeMatchFeatures(
      makeJob({ required_skills: ['Node.js', 'PostgreSQL', 'AWS', 'Docker'] }),
      makeCandidate({ skills: ['Node.js', 'PostgreSQL'] })
    );
    // intersection={node.js,postgresql}=2, union=4 -> 50%
    expect(f.jaccardSkillScore).toBe(50);
    expect(f.matchedSkills).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL']));
    expect(f.missingSkills).toEqual(expect.arrayContaining(['AWS', 'Docker']));
  });
});
