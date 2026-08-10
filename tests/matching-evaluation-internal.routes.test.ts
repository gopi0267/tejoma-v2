/**
 * Integration tests for src/api/matching-evaluation-internal.routes.ts (Batch 24) - real HTTP
 * against a minimal standalone Express app mounting only this router, against the real database.
 * Mirrors tests/analytics-internal.routes.test.ts's approach exactly (see its header comment for
 * why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import matchingEvaluationInternalRoutes from '../src/api/matching-evaluation-internal.routes.js';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

const app = express();
app.use(express.json());
app.use('/internal/matching-evaluation', matchingEvaluationInternalRoutes);

let companyId: number;
let jobId: number;
let candidateId: number;

beforeAll(async () => {
  const company = await pool.query(`INSERT INTO companies (name, company_slug) VALUES ('Matching Eval Internal Test Co', 'matching-eval-internal-test-co') RETURNING id`);
  companyId = company.rows[0].id;

  const job = await pool.query(`INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Eval Test Role', 'open', '{}') RETURNING id`, [companyId]);
  jobId = job.rows[0].id;

  const candidate = await pool.query(`INSERT INTO candidates (company_id, name, skills) VALUES ($1, 'Eval Test Candidate', 'Node.js') RETURNING id`, [companyId]);
  candidateId = candidate.rows[0].id;

  await pool.query(
    `INSERT INTO swipes (recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id) VALUES (1, $1, $2, 1, 70, NOW(), $3)`,
    [candidateId, jobId, companyId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE company_id = $1', [companyId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/matching-evaluation/swipes-for-evaluation', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/matching-evaluation/swipes-for-evaluation');
    expect(res.status).toBe(400);
  });

  it('returns real swipes for the company', async () => {
    const res = await request(app).get(`/internal/matching-evaluation/swipes-for-evaluation?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.swipes).toHaveLength(1);
    expect(res.body.swipes[0].job_id).toBe(jobId);
  });
});

describe('GET /internal/matching-evaluation/training-data', () => {
  it('returns pooled swipes/candidates/jobs including the seeded rows', async () => {
    const res = await request(app).get('/internal/matching-evaluation/training-data');
    expect(res.status).toBe(200);
    expect(res.body.swipes.some((s: any) => s.job_id === jobId)).toBe(true);
    expect(res.body.candidates.some((c: any) => c.id === candidateId)).toBe(true);
    expect(res.body.jobs.some((j: any) => j.id === jobId)).toBe(true);
  });
});

describe('POST /internal/matching-evaluation/score-batch', () => {
  it('requires job and candidates', async () => {
    const res = await request(app).post('/internal/matching-evaluation/score-batch').send({});
    expect(res.status).toBe(400);
  });

  it('scores real candidates against a real job via the unchanged live scoring engine', async () => {
    const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    const candidateRes = await pool.query('SELECT * FROM candidates WHERE id = $1', [candidateId]);
    const res = await request(app)
      .post('/internal/matching-evaluation/score-batch')
      .send({ job: jobRes.rows[0], candidates: candidateRes.rows, options: { skipGeminiSummary: true } });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(typeof res.body.results[0].final_score).toBe('number');
    expect(Array.isArray(res.body.results[0].feature_vector)).toBe(true);
    expect(res.body.results[0].feature_vector).toHaveLength(8);
  });
});

describe('GET /internal/matching-evaluation/job-titles', () => {
  it('requires companyId and jobIds', async () => {
    const res = await request(app).get('/internal/matching-evaluation/job-titles');
    expect(res.status).toBe(400);
  });

  it('returns titles for the requested, company-scoped job ids', async () => {
    const res = await request(app).get(`/internal/matching-evaluation/job-titles?companyId=${companyId}&jobIds=${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0]).toEqual({ id: jobId, title: 'Eval Test Role' });
  });

  it('silently drops ids that do not belong to the company (never leaks another tenant\'s job)', async () => {
    const res = await request(app).get(`/internal/matching-evaluation/job-titles?companyId=${companyId}&jobIds=${jobId},999999999`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].id).toBe(jobId);
  });
});
