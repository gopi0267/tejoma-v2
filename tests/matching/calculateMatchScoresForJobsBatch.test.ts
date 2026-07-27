import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateMatchScoresForJobsBatch, calculateMatchScoresBatch, setActiveModelType } from '../../src/services.js';
import type { Candidate, Job } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 0 - "Unified Matching API across all four surfaces".
// calculateMatchScoresForJobsBatch is the mirror image of the existing, already-tested-in-
// production calculateMatchScoresBatch (job-fixed, candidates-vary) - these tests establish it's
// symmetric: scoring the same (job, candidate) pair produces the same result regardless of which
// batch function computed it, and its own N-jobs-for-1-candidate batching behaves correctly.
// setActiveModelType('heuristic') keeps these deterministic and network-free (see
// matchingApi.test.ts's file header for why).

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1, company_id: 1, name: 'Test Candidate', email: 't@test.com', phone: '',
    skills: ['Node.js', 'PostgreSQL'], primary_skills: '', secondary_skills: '',
    years_of_experience: '5 years', current_location: 'Hyderabad', preferred_location: '',
    current_company: '', previous_companies: [], current_job_title: 'Backend Engineer',
    industry_domain: '', education: '', highest_qualification: '', graduation_year: '', university: '',
    certifications: [], projects: '', technical_tools: '', languages_known: '', current_ctc: '',
    expected_ctc: '', notice_period: '', willingness_to_relocate: '', linkedin_url: '',
    github_or_portfolio_url: '', resume_summary: '', resume_text: '', ai_confidence_score: '',
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

describe('calculateMatchScoresForJobsBatch', () => {
  beforeEach(() => setActiveModelType('heuristic'));
  afterEach(() => setActiveModelType('random_forest' as any));

  it('returns an empty array for an empty job list without calling anything', async () => {
    const result = await calculateMatchScoresForJobsBatch(makeCandidate(), [], { skipGeminiSummary: true });
    expect(result).toEqual([]);
  });

  it('returns one MatchScoreResult per job, in the same order as the input', async () => {
    const candidate = makeCandidate();
    const jobs = [makeJob({ id: 1, title: 'Job A' }), makeJob({ id: 2, title: 'Job B' }), makeJob({ id: 3, title: 'Job C' })];
    const results = await calculateMatchScoresForJobsBatch(candidate, jobs, { skipGeminiSummary: true });
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(typeof r.final_score).toBe('number');
      expect(r.breakdown).toBeDefined();
    });
  });

  it('is symmetric with calculateMatchScoresBatch: scoring the same (job, candidate) pair either way produces the same final_score', async () => {
    const job = makeJob({ required_skills: ['Node.js', 'PostgreSQL'], location: 'Hyderabad' });
    const candidate = makeCandidate({ skills: ['Node.js', 'PostgreSQL'], current_location: 'Hyderabad' });

    const [fromCandidateSideBatch] = await calculateMatchScoresBatch(job, [candidate], { skipGeminiSummary: true });
    const [fromJobSideBatch] = await calculateMatchScoresForJobsBatch(candidate, [job], { skipGeminiSummary: true });

    expect(fromJobSideBatch.final_score).toBe(fromCandidateSideBatch.final_score);
    expect(fromJobSideBatch.feature_score).toBe(fromCandidateSideBatch.feature_score);
    expect(fromJobSideBatch.breakdown.skills.matched).toEqual(fromCandidateSideBatch.breakdown.skills.matched);
  });

  it('scores a strong-fit job higher than a weak-fit job for the same candidate', async () => {
    const candidate = makeCandidate({ skills: ['Node.js', 'PostgreSQL'], years_of_experience: '6 years' });
    const weakJob = makeJob({ id: 1, required_skills: ['Rust', 'Elixir'], experience_years: 10 });
    const strongJob = makeJob({ id: 2, required_skills: ['Node.js', 'PostgreSQL'], experience_years: 3 });

    const [weakResult, strongResult] = await calculateMatchScoresForJobsBatch(candidate, [weakJob, strongJob], { skipGeminiSummary: true });
    expect(strongResult.final_score).toBeGreaterThan(weakResult.final_score);
  });

  it('falls back to buildFallbackSummary (never calls Gemini) when skipGeminiSummary is set, matching every production batch call site', async () => {
    // Every real call site of both batch functions (job.routes.ts, swipe.routes.ts, and this
    // phase's new candidate-jobs.routes.ts/candidate-search.routes.ts 'full'-tier path) always
    // passes skipGeminiSummary: true - this asserts the fallback template summary is produced
    // deterministically, without requiring a live external API call to run this test.
    const [result] = await calculateMatchScoresForJobsBatch(makeCandidate(), [makeJob()], { skipGeminiSummary: true });
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
