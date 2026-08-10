/**
 * Integration tests for src/api/candidate-internal.routes.ts (Batch 16) - real HTTP against a
 * minimal standalone Express app that mounts only this router, against the real database (same
 * DB_* env vars every other monolith test already requires - see .github/workflows/ci.yml). The
 * monolith's own server.ts binds a port directly rather than exporting `app` (unlike the Tier 0
 * services' server.ts/index.ts split), so route-level HTTP tests for it use this same
 * mount-just-the-router pattern rather than requiring the full app/Vite/static-file bootstrap.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import candidateInternalRoutes from '../src/api/candidate-internal.routes.js';

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
app.use('/internal/candidate', candidateInternalRoutes);

let companyId: number;
let jobId: number;
let candidateAccountId: number;

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (name, company_slug) VALUES ('Internal API Test Co', 'internal-api-test-co') RETURNING id`
  );
  companyId = company.rows[0].id;

  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Backend Engineer', 'open', '{}') RETURNING id`,
    [companyId]
  );
  jobId = job.rows[0].id;

  const candidate = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Internal API Test Candidate', 'internal-api-test@example.test', 'hashed', true) RETURNING id`
  );
  candidateAccountId = candidate.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_decisions WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM mutual_matches WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidates WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/candidate/jobs', () => {
  it('requires candidateAccountId', async () => {
    const res = await request(app).get('/internal/candidate/jobs');
    expect(res.status).toBe(400);
  });

  it('returns open jobs with a match_score for a real candidate', async () => {
    const res = await request(app).get(`/internal/candidate/jobs?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    const found = res.body.jobs.find((j: any) => j.id === jobId);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('match_score');
  });
});

describe('GET /internal/candidate/jobs/:id', () => {
  it('returns 404 for a closed/nonexistent job', async () => {
    const res = await request(app).get(`/internal/candidate/jobs/999999999?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(404);
  });

  it('returns the job with a match_score', async () => {
    const res = await request(app).get(`/internal/candidate/jobs/${jobId}?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body).toHaveProperty('match_score');
  });
});

describe('POST /internal/candidate/decisions', () => {
  it('validates required fields', async () => {
    const res = await request(app).post('/internal/candidate/decisions').send({ candidateAccountId });
    expect(res.status).toBe(400);
  });

  it('records a swipe_right decision and triggers the linked-candidate-row fan-out', async () => {
    const res = await request(app)
      .post('/internal/candidate/decisions')
      .send({ candidateAccountId, job_id: jobId, decision_type: 'swipe_right' });
    expect(res.status).toBe(201);
    // action is NUMERIC(3,1) in schema.sql - the pg driver returns numeric columns as strings
    // ("1.0", not "1") to avoid float precision loss, same convention db.ts's own
    // getUnusedSwipesForTraining works around elsewhere with Number(row.action).
    expect(Number(res.body.decision.action)).toBe(1);

    // The fan-out (getOrCreateLinkedCandidateRow) should have created a linked candidates row -
    // proves the exact same business behavior as the monolith's own POST /candidate-decisions
    // (src/api/candidate-decisions.routes.ts), not a simplified reimplementation.
    const linked = await pool.query('SELECT id FROM candidates WHERE candidate_account_id = $1 AND company_id = $2', [candidateAccountId, companyId]);
    expect(linked.rows.length).toBe(1);
  });

  it('rejects a duplicate identical decision', async () => {
    const res = await request(app)
      .post('/internal/candidate/decisions')
      .send({ candidateAccountId, job_id: jobId, decision_type: 'swipe_right' });
    expect(res.status).toBe(400);
  });
});

describe('GET /internal/candidate/decisions', () => {
  it('returns the decision history just recorded', async () => {
    const res = await request(app).get(`/internal/candidate/decisions?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(200);
    expect(res.body.decisions.length).toBeGreaterThan(0);
    expect(res.body.decisions[0].job_id).toBe(jobId);
  });
});

describe('GET /internal/candidate/decisions/status', () => {
  it('reports "waiting" when the recruiter has not acted yet', async () => {
    const res = await request(app).get(`/internal/candidate/decisions/status?candidateAccountId=${candidateAccountId}&jobId=${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('waiting');
  });
});

describe('GET /internal/candidate/matches', () => {
  it('returns an empty list when no mutual match exists yet', async () => {
    const res = await request(app).get(`/internal/candidate/matches?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });
});

describe('GET /internal/candidate/applications', () => {
  it('returns an empty list when the candidate has not applied to anything', async () => {
    const res = await request(app).get(`/internal/candidate/applications?candidateAccountId=${candidateAccountId}`);
    expect(res.status).toBe(200);
    expect(res.body.applications).toEqual([]);
  });
});
