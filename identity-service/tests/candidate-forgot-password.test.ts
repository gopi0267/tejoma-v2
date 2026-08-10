/**
 * Integration tests for the candidate OTP-based password reset flow - mirrors
 * tests/password-reset.test.ts's structure and discipline exactly, applied to candidate_accounts
 * instead of users. No real email is sent (same reasoning as candidate-registration.test.ts's
 * header comment: this test environment never has real GMAIL_USER/GMAIL_APP_PASSWORD exported
 * into it).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_EMAIL = 'batch8-reset-candidate@example.test';
const OLD_PASSWORD = 'OriginalCandidate9!';
const NEW_PASSWORD = 'BrandNewCandidate9!';

let testCandidateId: number;

beforeAll(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1', [TEST_EMAIL]);
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id IN (SELECT id FROM candidate_accounts WHERE email = $1)', [TEST_EMAIL]);
  await pool.query('DELETE FROM candidate_accounts WHERE email = $1', [TEST_EMAIL]);

  const passwordHash = await bcrypt.hash(OLD_PASSWORD, 10);
  const result = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    ['Batch 8 Reset Candidate', TEST_EMAIL, passwordHash]
  );
  testCandidateId = result.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1', [TEST_EMAIL]);
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id = $1', [testCandidateId]);
  await pool.query("DELETE FROM audit_log WHERE actor_type = 'candidate' AND actor_id = $1", [testCandidateId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [testCandidateId]);
  await closePool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1', [TEST_EMAIL]);
});

async function requestOtpAndGetPlaintext(): Promise<string> {
  await request(app).post('/api/candidate-auth/forgot-password/start').send({ identifier: TEST_EMAIL });
  const otp = '123456';
  const hash = await bcrypt.hash(otp, 10);
  await pool.query(
    `UPDATE otp_verification SET otp_hash = $1 WHERE email = $2 AND purpose = 'candidate_reset' AND id = (
       SELECT id FROM otp_verification WHERE email = $2 AND purpose = 'candidate_reset' ORDER BY created_at DESC LIMIT 1
     )`,
    [hash, TEST_EMAIL]
  );
  return otp;
}

describe('POST /api/candidate-auth/forgot-password/start', () => {
  it('does not reveal whether an unknown account exists', async () => {
    const res = await request(app).post('/api/candidate-auth/forgot-password/start').send({ identifier: 'nobody@example.test' });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If an account exists');
  });

  it('creates a real, hashed otp_verification row for a known account', async () => {
    const res = await request(app).post('/api/candidate-auth/forgot-password/start').send({ identifier: TEST_EMAIL });
    expect(res.status).toBe(200);

    const row = await pool.query("SELECT * FROM otp_verification WHERE email = $1 AND purpose = 'candidate_reset'", [TEST_EMAIL]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].verified).toBe(false);
  });
});

describe('POST /api/candidate-auth/forgot-password/verify-otp + reset', () => {
  it('rejects an incorrect OTP', async () => {
    await requestOtpAndGetPlaintext();
    const res = await request(app).post('/api/candidate-auth/forgot-password/verify-otp').send({ identifier: TEST_EMAIL, otp: '000000' });
    expect(res.status).toBe(400);
  });

  it('rejects a reset attempt if the OTP was never verified', async () => {
    await requestOtpAndGetPlaintext();
    const res = await request(app).post('/api/candidate-auth/forgot-password/reset').send({ identifier: TEST_EMAIL, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Please verify your code first');
  });

  it('rejects reusing the current password', async () => {
    const otp = await requestOtpAndGetPlaintext();
    await request(app).post('/api/candidate-auth/forgot-password/verify-otp').send({ identifier: TEST_EMAIL, otp });
    const res = await request(app).post('/api/candidate-auth/forgot-password/reset').send({ identifier: TEST_EMAIL, new_password: OLD_PASSWORD, confirm_password: OLD_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('cannot reuse your current password');
  });

  it('resets the password end-to-end: old password stops working, new password works, and every existing session is revoked', async () => {
    const loginRes = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: OLD_PASSWORD });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('candidate_refresh_token='))!.split(';')[0];

    const otp = await requestOtpAndGetPlaintext();
    const verifyRes = await request(app).post('/api/candidate-auth/forgot-password/verify-otp').send({ identifier: TEST_EMAIL, otp });
    expect(verifyRes.status).toBe(200);

    const resetRes = await request(app).post('/api/candidate-auth/forgot-password/reset').send({ identifier: TEST_EMAIL, new_password: NEW_PASSWORD, confirm_password: NEW_PASSWORD });
    expect(resetRes.status).toBe(200);

    const oldLoginAttempt = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: OLD_PASSWORD });
    expect(oldLoginAttempt.status).toBe(401);

    const newLoginAttempt = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: NEW_PASSWORD });
    expect(newLoginAttempt.status).toBe(200);

    const revokedSessionCheck = await request(app).post('/api/candidate-auth/refresh').set('Cookie', refreshCookie);
    expect(revokedSessionCheck.status).toBe(401);
  });
});
