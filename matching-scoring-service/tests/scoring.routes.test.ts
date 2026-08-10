/**
 * Integration tests for POST /internal/score/* - real HTTP against a real database.
 * MATCHING_ML_SERVICE_URL is deliberately pointed at an unreachable address for the whole file
 * (same discipline as matching-bge-shadow-service's tests) so getEnsembleHealth deterministically
 * returns null, exercising the real heuristic-fallback path instead of depending on whether
 * python-services/matching-ml-service happens to be running and trained locally.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../src/config/env.js'; // must load before db.js's module-level Pool construction reads process.env.DB_PASSWORD
import { pool } from '../src/db.js';

let app: import('express').Express;

const JOB = {
  id: 9001,
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
  id: 9101,
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
  id: 9102,
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
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable - see header comment
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await pool.query('DELETE FROM scoring_computations WHERE job_id = $1', [JOB.id]);
  await pool.end();
});

describe('POST /internal/score/candidates-batch', () => {
  it('requires job and candidates[]', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/score/candidates-batch').send({});
    expect(res.status).toBe(400);
  });

  it('scores a strong match higher than a weak match, and stores a real row', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/score/candidates-batch')
      .send({ job: JOB, candidates: [CANDIDATE_STRONG, CANDIDATE_WEAK], modelType: 'heuristic' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);

    const [strong, weak] = res.body.results;
    expect(strong.final_score).toBeGreaterThan(weak.final_score);
    // Exact skills match (3/3) + same city + within-band salary -> feature_score should be high.
    expect(strong.feature_score).toBeGreaterThanOrEqual(90);
    expect(strong.breakdown.skills.matched).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL', 'TypeScript']));

    const stored = await pool.query('SELECT * FROM scoring_computations WHERE job_id = $1', [JOB.id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].request_kind).toBe('candidates_batch');
    expect(stored.rows[0].subject_count).toBe(2);
    expect(stored.rows[0].model_type).toBe('heuristic');
  });
});

describe('POST /internal/score/jobs-batch', () => {
  it('requires candidate and jobs[]', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/score/jobs-batch').send({});
    expect(res.status).toBe(400);
  });

  it('scores a real job against a real candidate, mirroring the candidates-batch feature_score', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/score/jobs-batch')
      .send({ candidate: CANDIDATE_STRONG, jobs: [JOB], modelType: 'heuristic' });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].feature_score).toBeGreaterThanOrEqual(90);

    await pool.query('DELETE FROM scoring_computations WHERE job_id = $1 AND request_kind = $2', [JOB.id, 'jobs_batch']);
  });
});
