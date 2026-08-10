/**
 * Direct test for db.ts's syncApplicationStatusFromRecruiterDecision (Batch 20) - the second of
 * two candidate_notifications write sites touched this batch (the first, createMatchNotifications,
 * is already covered end-to-end by tests/candidate-internal.routes.test.ts). This one fires from
 * recordSwipe's fire-and-forget hook when a recruiter swipes on a candidate who formally applied -
 * swipe.routes.ts itself is out of this batch's scope (Batch 19's domain audit deferred it, still
 * Matching-coupled), so this exercises the function directly rather than through the full HTTP
 * route, the same level the function's own logic warrants.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
import { syncApplicationStatusFromRecruiterDecision } from '../src/db.js';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

let companyId: number;
let jobId: number;
let candidateAccountId: number;
let candidatesId: number;

beforeAll(async () => {
  const company = await pool.query(`INSERT INTO companies (name, company_slug) VALUES ('Sync Status Test Co', 'sync-status-test-co') RETURNING id`);
  companyId = company.rows[0].id;

  const job = await pool.query(`INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Open Role', 'open', '{}') RETURNING id`, [companyId]);
  jobId = job.rows[0].id;

  const candidateAccount = await pool.query(`INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Applicant', 'applicant-sync-test@example.test', 'hashed', true) RETURNING id`);
  candidateAccountId = candidateAccount.rows[0].id;

  const candidate = await pool.query(`INSERT INTO candidates (company_id, name, candidate_account_id) VALUES ($1, 'Applicant', $2) RETURNING id`, [companyId, candidateAccountId]);
  candidatesId = candidate.rows[0].id;

  // A formal 'apply' decision is the precondition this function checks before syncing anything.
  await pool.query(
    `INSERT INTO candidate_decisions (candidate_account_id, job_id, action, decision_type) VALUES ($1, $2, 1, 'apply')`,
    [candidateAccountId, jobId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_notifications WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidate_application_status WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidate_decisions WHERE candidate_account_id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidatesId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateAccountId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('syncApplicationStatusFromRecruiterDecision', () => {
  it('records the application status and creates a candidate_notifications row', async () => {
    await syncApplicationStatusFromRecruiterDecision(candidatesId, jobId, companyId, 1);

    const statusRes = await pool.query('SELECT status FROM candidate_application_status WHERE candidate_account_id = $1 AND job_id = $2', [candidateAccountId, jobId]);
    expect(statusRes.rows[0].status).toBe('accepted');

    const notifRes = await pool.query(
      `SELECT type, title, message, job_id, match_id FROM candidate_notifications WHERE candidate_account_id = $1 AND type = 'application_status_changed'`,
      [candidateAccountId]
    );
    expect(notifRes.rows).toHaveLength(1);
    expect(notifRes.rows[0].job_id).toBe(jobId);
    expect(notifRes.rows[0].match_id).toBeNull();
    expect(notifRes.rows[0].title).toContain('Application update');
    expect(notifRes.rows[0].message).toContain('Accepted');
  });
});
