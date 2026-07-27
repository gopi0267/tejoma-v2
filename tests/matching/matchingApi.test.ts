import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  rankCandidatesForJob,
  rankJobsForCandidate,
  toSyntheticCandidateFromAccount,
  toSyntheticJobFromQuery,
} from '../../src/matching/matchingApi.js';
import { setActiveModelType } from '../../src/services.js';
import type { Candidate, Job, CandidateAccount } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 0 - "Unified Matching API across all four surfaces".
// setActiveModelType('heuristic') keeps the 'full' tier tests network-free and deterministic (it
// makes calculateMatchScoresBatch/calculateMatchScoresForJobsBatch skip the ML-ensemble HTTP call
// entirely - see services.ts's `if (activeModelType !== 'heuristic')` gate), exercising the SAME
// real code path job.routes.ts/swipe.routes.ts/candidate-jobs.routes.ts run in production rather
// than mocking it away. Every test also passes skipGeminiSummary: true, matching how every
// existing production call site already avoids the Gemini dependency for batch scoring.

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

function makeCandidateAccount(overrides: Partial<CandidateAccount> = {}): CandidateAccount {
  return {
    id: 1, name: 'Account Candidate', email: 'a@test.com', phone: '', password_hash: '',
    is_active: true, headline: 'Backend Engineer', skills: ['Node.js', 'PostgreSQL'],
    years_of_experience: '5 years', location: 'Hyderabad', education: '', summary: '',
    created_at: '', updated_at: '',
    ...overrides,
  } as CandidateAccount;
}

describe('matchingApi - synthetic object adapters', () => {
  it('toSyntheticCandidateFromAccount maps a candidate_accounts row to the shape computeMatchFeatures expects', () => {
    const account = makeCandidateAccount({ skills: ['Python', 'Django'], years_of_experience: '3 years', location: 'Pune', headline: 'Django Developer', summary: 'Built APIs.' });
    const synthetic = toSyntheticCandidateFromAccount(account);
    expect(synthetic.skills).toEqual(['Python', 'Django']);
    expect(synthetic.years_of_experience).toBe('3 years');
    expect(synthetic.current_location).toBe('Pune');
    expect(synthetic.current_job_title).toBe('Django Developer');
    expect(synthetic.resume_text).toBe('Built APIs.');
  });

  it('toSyntheticCandidateFromAccount defaults skills to an empty array when null', () => {
    const account = makeCandidateAccount({ skills: null });
    expect(toSyntheticCandidateFromAccount(account).skills).toEqual([]);
  });

  it('toSyntheticJobFromQuery maps search filters to the shape computeMatchFeatures expects', () => {
    const job = toSyntheticJobFromQuery({ skills: ['React', 'TypeScript'], location: 'Bengaluru', jobTitle: 'Frontend Engineer', minExperience: 2 });
    expect(job.required_skills).toEqual(['React', 'TypeScript']);
    expect(job.location).toBe('Bengaluru');
    expect(job.title).toBe('Frontend Engineer');
    expect(job.experience_years).toBe(2);
  });

  it('toSyntheticJobFromQuery falls back to q for title when jobTitle is absent', () => {
    const job = toSyntheticJobFromQuery({ q: 'react developer' });
    expect(job.title).toBe('react developer');
    expect(job.description).toBe('react developer');
  });
});

describe('matchingApi - rankCandidatesForJob, tier: heuristic', () => {
  it('scores every candidate and returns one entry per candidate, unsorted (caller sorts)', async () => {
    const job = makeJob({ required_skills: ['Node.js', 'PostgreSQL'] });
    const strong = makeCandidate({ id: 1, skills: ['Node.js', 'PostgreSQL'] });
    const weak = makeCandidate({ id: 2, skills: ['Java'] });
    const ranked = await rankCandidatesForJob(job, [weak, strong], { tier: 'heuristic' });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].candidate.id).toBe(2); // insertion order preserved - no internal sort
    expect(ranked[1].candidate.id).toBe(1);
    expect(ranked[1].match_score).toBeGreaterThan(ranked[0].match_score); // strong match scores higher
  });

  it('never calls the ML ensemble or attaches a score breakdown in heuristic tier', async () => {
    const ranked = await rankCandidatesForJob(makeJob(), [makeCandidate()], { tier: 'heuristic' });
    expect(ranked[0].score).toBeUndefined();
  });

  it('returns an empty array for an empty candidate pool without error', async () => {
    const ranked = await rankCandidatesForJob(makeJob(), [], { tier: 'heuristic' });
    expect(ranked).toEqual([]);
  });
});

describe('matchingApi - rankCandidatesForJob, tier: full', () => {
  const originalModelType = 'random_forest'; // services.ts's default

  beforeEach(() => setActiveModelType('heuristic'));
  afterEach(() => setActiveModelType(originalModelType as any));

  it('sorts results by match_score descending (unlike heuristic tier, which leaves sorting to the caller)', async () => {
    const job = makeJob({ required_skills: ['Node.js', 'PostgreSQL'] });
    const weak = makeCandidate({ id: 2, skills: ['Java'] });
    const strong = makeCandidate({ id: 1, skills: ['Node.js', 'PostgreSQL'] });
    const ranked = await rankCandidatesForJob(job, [weak, strong], { tier: 'full', skipGeminiSummary: true });
    expect(ranked[0].candidate.id).toBe(1);
    expect(ranked[0].match_score).toBeGreaterThanOrEqual(ranked[1].match_score);
  });

  it('attaches a full score breakdown (skills/experience/location/salary/similarity) per candidate', async () => {
    const ranked = await rankCandidatesForJob(makeJob(), [makeCandidate()], { tier: 'full', skipGeminiSummary: true });
    const { score } = ranked[0];
    expect(score).toBeDefined();
    expect(score!.breakdown.skills).toBeDefined();
    expect(score!.breakdown.experience).toBeDefined();
    expect(score!.breakdown.location).toBeDefined();
    expect(score!.breakdown.salary).toBeDefined();
    expect(typeof score!.final_score).toBe('number');
  });

  it('does not attempt persistence when options.persist is omitted', async () => {
    // No company_id/real ids required at all when persist is absent - if this test throws, the
    // module attempted a DB write it shouldn't have.
    const job = makeJob({ id: undefined as any });
    const candidate = makeCandidate({ id: undefined as any });
    await expect(rankCandidatesForJob(job, [candidate], { tier: 'full', skipGeminiSummary: true })).resolves.toBeDefined();
  });

  it('skips persistence entirely (no DB write attempted) when the job has no real id, without throwing', async () => {
    // persistCandidateMatchScores' `if (!job.id) return;` early-out - exercised here with
    // options.persist actually set, so this specifically verifies the guard, not just that
    // persistence was never requested (the test above covers that separate case).
    const job = makeJob({ id: undefined as any });
    const candidate = makeCandidate({ id: 1 });
    const ranked = await rankCandidatesForJob(job, [candidate], { tier: 'full', skipGeminiSummary: true, persist: { companyId: 1 } });
    expect(ranked).toHaveLength(1);
  });
});

describe('matchingApi - rankJobsForCandidate, tier: heuristic', () => {
  it('scores every job against the fixed candidate, unsorted (matches candidate-jobs.routes.ts pre-existing behavior)', async () => {
    const candidate = makeCandidate({ skills: ['Node.js', 'PostgreSQL'] });
    const weakJob = makeJob({ id: 1, required_skills: ['Rust'] });
    const strongJob = makeJob({ id: 2, required_skills: ['Node.js', 'PostgreSQL'] });
    const ranked = await rankJobsForCandidate(candidate, [weakJob, strongJob], { tier: 'heuristic' });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].job.id).toBe(1); // insertion order preserved, exactly as candidate-jobs.routes.ts never sorted
    expect(ranked[1].match_score).toBeGreaterThan(ranked[0].match_score);
  });

  it('returns an empty array for an empty job list without error', async () => {
    const ranked = await rankJobsForCandidate(makeCandidate(), [], { tier: 'heuristic' });
    expect(ranked).toEqual([]);
  });
});

describe('matchingApi - rankJobsForCandidate, tier: full', () => {
  beforeEach(() => setActiveModelType('heuristic'));
  afterEach(() => setActiveModelType('random_forest' as any));

  it('scores N jobs against 1 candidate using the batched job-side pipeline', async () => {
    const candidate = makeCandidate({ skills: ['Node.js', 'PostgreSQL'] });
    const jobA = makeJob({ id: 1, required_skills: ['Rust'] });
    const jobB = makeJob({ id: 2, required_skills: ['Node.js', 'PostgreSQL'] });
    const ranked = await rankJobsForCandidate(candidate, [jobA, jobB], { tier: 'full', skipGeminiSummary: true });
    expect(ranked).toHaveLength(2);
    expect(ranked[1].score).toBeDefined();
    expect(ranked[1].match_score).toBeGreaterThan(ranked[0].match_score);
  });
});
