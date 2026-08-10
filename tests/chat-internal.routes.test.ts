/**
 * Integration tests for src/api/chat-internal.routes.ts (Batch 17) - real HTTP against a minimal
 * standalone Express app mounting only this router, against the real database. Mirrors
 * tests/candidate-internal.routes.test.ts's approach exactly (see its header comment for why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import chatInternalRoutes from '../src/api/chat-internal.routes.js';

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
app.use('/internal/chat', chatInternalRoutes);

let companyId: number;
let jobId: number;
let candidateId: number;

beforeAll(async () => {
  const company = await pool.query(`INSERT INTO companies (name, company_slug) VALUES ('Chat Internal Test Co', 'chat-internal-test-co') RETURNING id`);
  companyId = company.rows[0].id;

  const job = await pool.query(`INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Open Role', 'open', '{}') RETURNING id`, [companyId]);
  jobId = job.rows[0].id;

  const candidate = await pool.query(`INSERT INTO candidates (company_id, name) VALUES ($1, 'Chat Internal Test Candidate') RETURNING id`, [companyId]);
  candidateId = candidate.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/chat/stats', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/chat/stats');
    expect(res.status).toBe(400);
  });

  it('returns real candidate/job counts for the company', async () => {
    const res = await request(app).get(`/internal/chat/stats?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.candidateCount).toBe(1);
    expect(res.body.jobCount).toBe(1);
  });
});

describe('GET /internal/chat/candidates-unscoped', () => {
  it('returns candidates across companies (deliberately unscoped, matching ML training reads)', async () => {
    const res = await request(app).get('/internal/chat/candidates-unscoped');
    expect(res.status).toBe(200);
    expect(res.body.candidates.some((c: any) => c.id === candidateId)).toBe(true);
  });
});

describe('GET /internal/chat/jobs-unscoped', () => {
  it('returns open jobs across companies', async () => {
    const res = await request(app).get('/internal/chat/jobs-unscoped');
    expect(res.status).toBe(200);
    expect(res.body.jobs.some((j: any) => j.id === jobId)).toBe(true);
  });
});
