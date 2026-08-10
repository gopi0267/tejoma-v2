/**
 * Integration tests for src/api/recruiting-internal.routes.ts (Batch 19) - real HTTP against a
 * minimal standalone Express app mounting only this router, against the real database. Mirrors
 * tests/chat-internal.routes.test.ts's approach exactly (see its header comment for why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import recruitingInternalRoutes from '../src/api/recruiting-internal.routes.js';

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
app.use('/internal/recruiting', recruitingInternalRoutes);

let companyId: number;
let jobId: number;
let candidateId: number;
let candidateAccountId: number;
let userId: number;
let matchId: number;

beforeAll(async () => {
  const company = await pool.query(`INSERT INTO companies (name, company_slug) VALUES ('Recruiting Internal Test Co', 'recruiting-internal-test-co') RETURNING id`);
  companyId = company.rows[0].id;

  const user = await pool.query(`INSERT INTO users (email, password_hash, company_id, role, name) VALUES ('recruiter-internal-test@example.test', 'hashed', $1, 'recruiter', 'Test Recruiter') RETURNING id`, [companyId]);
  userId = user.rows[0].id;

  const job = await pool.query(`INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Open Role', 'open', '{}') RETURNING id`, [companyId]);
  jobId = job.rows[0].id;

  const candidate = await pool.query(`INSERT INTO candidates (company_id, name) VALUES ($1, 'Recruiting Internal Test Candidate') RETURNING id`, [companyId]);
  candidateId = candidate.rows[0].id;

  const candidateAccount = await pool.query(`INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Matched Candidate', 'matched-internal-test@example.test', 'hashed', true) RETURNING id`);
  candidateAccountId = candidateAccount.rows[0].id;

  const match = await pool.query(
    `INSERT INTO mutual_matches (candidate_account_id, job_id, company_id, candidates_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [candidateAccountId, jobId, companyId, candidateId]
  );
  matchId = match.rows[0].id;

  await pool.query(
    `INSERT INTO recruiter_notifications (user_id, company_id, match_id, type, title, message) VALUES ($1, $2, $3, 'match_created', 'New match', 'msg')`,
    [userId, companyId, matchId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM recruiter_notifications WHERE match_id = $1', [matchId]);
  await pool.query('DELETE FROM mutual_matches WHERE id = $1', [matchId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/recruiting/matches', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/recruiting/matches');
    expect(res.status).toBe(400);
  });

  it('returns the real match with job/candidate/notification data joined', async () => {
    const res = await request(app).get(`/internal/recruiting/matches?companyId=${companyId}&userId=${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(1);
    const match = res.body.matches[0];
    expect(match.id).toBe(matchId);
    expect(match.job_title).toBe('Open Role');
    expect(match.candidate_id).toBe(candidateId);
    expect(match.notification_id).not.toBeNull();
    expect(match.read_at).toBeNull();
  });

  it('filters by jobId', async () => {
    const res = await request(app).get(`/internal/recruiting/matches?companyId=${companyId}&jobId=999999`);
    expect(res.status).toBe(200);
    expect(res.body.matches).toHaveLength(0);
  });
});
