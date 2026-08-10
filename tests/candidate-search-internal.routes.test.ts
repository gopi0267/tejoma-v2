/**
 * Integration tests for src/api/candidate-search-internal.routes.ts (Remaining-monolith
 * migration, Step 5) - real HTTP against a minimal standalone Express app that mounts only this
 * router, against the real database. Same mount-just-the-router pattern as
 * tests/candidate-internal.routes.test.ts (see its header comment for why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import candidateSearchInternalRoutes from '../src/api/candidate-search-internal.routes.js';

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
app.use('/internal/candidate-search', candidateSearchInternalRoutes);

let companyId: number;
let jobId: number;
let candidateAccountId: number;
let candidateId: number;

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (name, company_slug) VALUES ('Candidate Search Internal Test Co', 'candidate-search-internal-test-co') RETURNING id`
  );
  companyId = company.rows[0].id;

  const job = await pool.query(
    `INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Backend Engineer', 'open', '{}') RETURNING id`,
    [companyId]
  );
  jobId = job.rows[0].id;

  const candidateAccount = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Shortlist Target', 'shortlist-target@example.test', 'hashed', true) RETURNING id`
  );
  candidateAccountId = candidateAccount.rows[0].id;

  const candidate = await pool.query(
    `INSERT INTO candidates (name, company_id, candidate_account_id) VALUES ('Shortlist Target', $1, $2) RETURNING id`,
    [companyId, candidateAccountId]
  );
  candidateId = candidate.rows[0].id;

  await pool.query(
    `INSERT INTO swipes (recruiter_id, candidate_id, job_id, action, company_id, "timestamp") VALUES (1, $1, $2, 1, $3, NOW())`,
    [candidateId, jobId, companyId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE company_id = $1', [companyId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/candidate-search/shortlisted', () => {
  it('rejects a request with no companyId', async () => {
    const res = await request(app).get('/internal/candidate-search/shortlisted');
    expect(res.status).toBe(400);
  });

  it('returns the candidate_account rows behind this company\'s Accepted swipes, unshaped', async () => {
    const res = await request(app).get('/internal/candidate-search/shortlisted').query({ companyId });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(candidateAccountId);
    expect(res.body.candidates[0].name).toBe('Shortlist Target');
  });

  it('returns an empty list for a company with no Accepted swipes', async () => {
    const res = await request(app).get('/internal/candidate-search/shortlisted').query({ companyId: 999999999 });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });
});
