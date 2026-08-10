/**
 * Integration tests for /internal/rank-candidates-for-job, /internal/rank-jobs-for-candidate,
 * /internal/score-candidate-for-job, and the two synthetic-object adapters - real HTTP against a
 * real database, MATCHING_ML_SERVICE_URL deliberately unreachable (see scoring.routes.test.ts's
 * header comment for why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../src/config/env.js';
import { pool } from '../src/db.js';

let app: import('express').Express;

const JOB = {
  id: 9501,
  company_id: 1,
  title: 'Backend Engineer',
  description: 'Build APIs with Node.js and PostgreSQL',
  required_skills: ['Node.js', 'PostgreSQL', 'TypeScript'],
  experience_years: 3,
  location: 'Hyderabad',
  salary_min: 800000,
  salary_max: 1500000,
};

const CANDIDATE_STRONG = {
  id: 9601,
  company_id: 1,
  name: 'Strong Match',
  skills: ['Node.js', 'PostgreSQL', 'TypeScript'],
  years_of_experience: '5 years',
  current_location: 'Hyderabad',
  current_job_title: 'Backend Engineer',
  current_ctc: '10 LPA',
  expected_ctc: '12 LPA',
  resume_text: 'Backend engineer with Node.js and PostgreSQL experience',
};

const CANDIDATE_WEAK = {
  id: 9602,
  company_id: 1,
  name: 'Weak Match',
  skills: ['PHP', 'MySQL'],
  years_of_experience: '1 years',
  current_location: 'Remote',
  current_job_title: 'Junior Developer',
  current_ctc: '4 LPA',
  expected_ctc: '5 LPA',
  resume_text: 'Junior developer with PHP experience',
};

beforeAll(async () => {
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await pool.query('DELETE FROM match_scores WHERE job_id = $1', [JOB.id]);
  await pool.query('DELETE FROM match_features WHERE job_id = $1', [JOB.id]);
  await pool.end();
});

describe('POST /internal/rank-candidates-for-job', () => {
  it('requires job, candidates[], and a valid tier', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/rank-candidates-for-job').send({ job: JOB, candidates: [] });
    expect(res.status).toBe(400);
  });

  it('heuristic tier: ranks without calling the ML ensemble, no persistence', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/rank-candidates-for-job')
      .send({ job: JOB, candidates: [CANDIDATE_STRONG, CANDIDATE_WEAK], tier: 'heuristic' });

    expect(res.status).toBe(200);
    expect(res.body.ranked).toHaveLength(2);
    // Heuristic tier isn't sorted by the API itself (matches the monolith's original behavior).
    const strong = res.body.ranked.find((r: any) => r.candidate.id === CANDIDATE_STRONG.id);
    expect(strong.match_score).toBeGreaterThanOrEqual(90);
    expect(strong.score).toBeUndefined();

    const stored = await pool.query('SELECT * FROM match_scores WHERE job_id = $1', [JOB.id]);
    expect(stored.rows).toHaveLength(0);
  });

  it('full tier with persist: ranks (sorted), returns full score breakdown, and really persists match_scores + match_features', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/rank-candidates-for-job')
      .send({
        job: JOB,
        candidates: [CANDIDATE_WEAK, CANDIDATE_STRONG], // deliberately out of rank order
        tier: 'full',
        modelType: 'heuristic',
        persist: { companyId: 1, source: 'test' },
      });

    expect(res.status).toBe(200);
    expect(res.body.ranked).toHaveLength(2);
    // Sorted descending by match_score - strong match first despite being passed second.
    expect(res.body.ranked[0].candidate.id).toBe(CANDIDATE_STRONG.id);
    expect(res.body.ranked[0].score.breakdown).toBeDefined();

    const scores = await pool.query('SELECT * FROM match_scores WHERE job_id = $1 ORDER BY rank', [JOB.id]);
    expect(scores.rows).toHaveLength(2);
    expect(scores.rows[0].candidate_id).toBe(CANDIDATE_STRONG.id);
    expect(scores.rows[0].rank).toBe(1);

    const features = await pool.query('SELECT * FROM match_features WHERE job_id = $1', [JOB.id]);
    expect(features.rows).toHaveLength(2);
    expect(features.rows[0].source).toBe('test');
    expect(features.rows[0].tier).toBe('full');
  });
});

describe('POST /internal/rank-jobs-for-candidate', () => {
  it('requires candidate, jobs[], and a valid tier', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/rank-jobs-for-candidate').send({});
    expect(res.status).toBe(400);
  });

  it('ranks real jobs against a real candidate', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/rank-jobs-for-candidate')
      .send({ candidate: CANDIDATE_STRONG, jobs: [JOB], tier: 'heuristic' });
    expect(res.status).toBe(200);
    expect(res.body.ranked).toHaveLength(1);
    expect(res.body.ranked[0].match_score).toBeGreaterThanOrEqual(90);
  });
});

describe('POST /internal/score-candidate-for-job', () => {
  it('requires job and candidate', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/score-candidate-for-job').send({ job: JOB });
    expect(res.status).toBe(400);
  });

  it('scores a single real candidate against a real job (full tier, never persists)', async () => {
    const request = (await import('supertest')).default;
    const before = await pool.query('SELECT COUNT(*)::int AS count FROM match_scores WHERE job_id = $1', [JOB.id]);
    const res = await request(app).post('/internal/score-candidate-for-job').send({ job: JOB, candidate: CANDIDATE_STRONG, modelType: 'heuristic' });
    expect(res.status).toBe(200);
    expect(res.body.score.final_score).toBeGreaterThanOrEqual(90);
    const after = await pool.query('SELECT COUNT(*)::int AS count FROM match_scores WHERE job_id = $1', [JOB.id]);
    expect(after.rows[0].count).toBe(before.rows[0].count); // scoreCandidateForJob never sets `persist`
  });
});

describe('synthetic object adapters', () => {
  it('POST /internal/synthetic-candidate-from-account maps fields correctly', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/synthetic-candidate-from-account')
      .send({ skills: ['Go'], years_of_experience: '4 years', location: 'Pune', headline: 'Backend Dev', summary: 'Experienced backend developer' });
    expect(res.status).toBe(200);
    expect(res.body.candidate).toEqual({
      skills: ['Go'],
      years_of_experience: '4 years',
      current_location: 'Pune',
      current_job_title: 'Backend Dev',
      resume_text: 'Experienced backend developer',
    });
  });

  it('POST /internal/synthetic-job-from-query maps fields correctly', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/synthetic-job-from-query').send({ skills: ['Go'], location: 'Pune', jobTitle: 'Backend Engineer', minExperience: 2 });
    expect(res.status).toBe(200);
    expect(res.body.job).toEqual({
      required_skills: ['Go'],
      location: 'Pune',
      title: 'Backend Engineer',
      description: '',
      experience_years: 2,
    });
  });
});
