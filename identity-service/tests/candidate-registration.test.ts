/**
 * Integration tests for the OTP-based candidate registration flow - real HTTP, real Identity DB,
 * real bcrypt/OTP hashing throughout, mirroring tests/password-reset.test.ts's discipline: email
 * delivery is not mocked, but this test environment never has real GMAIL_USER/GMAIL_APP_PASSWORD
 * or TWILIO_* credentials exported into it (only DB_* vars are), so sendOTPEmail/sendOTPSms take
 * their "not configured" no-op branch regardless of which address/number is used - no real email
 * or SMS is ever dispatched by this file. OTPs are read back via a known plaintext seeded directly
 * into otp_verification (same technique as password-reset.test.ts), not by intercepting delivery.
 *
 * Includes one phone-identifier registration test using a real, user-authorized number
 * (+917207179473) for the E.164 format path through normalizeIdentifier/libphonenumber-js - since
 * Twilio is not configured in this environment (confirmed: TWILIO_ACCOUNT_SID/AUTH_TOKEN/
 * FROM_NUMBER are unset here), no real SMS reaches that number from this test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_EMAIL = 'batch8-test-candidate@example.test';
const TEST_PHONE = '+917207179473';
const TEST_NAME = 'Batch 8 Test Candidate';
const TEST_PASSWORD = 'FreshCandidate9!';

const createdCandidateIds: number[] = [];

beforeAll(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1 OR phone = $2', [TEST_EMAIL, TEST_PHONE]);
  await pool.query('DELETE FROM candidate_accounts WHERE email = $1 OR phone = $2', [TEST_EMAIL, TEST_PHONE]);
});

afterAll(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1 OR phone = $2', [TEST_EMAIL, TEST_PHONE]);
  if (createdCandidateIds.length > 0) {
    await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id = ANY($1)', [createdCandidateIds]);
    await pool.query("DELETE FROM audit_log WHERE actor_type = 'candidate' AND actor_id = ANY($1)", [createdCandidateIds]);
    await pool.query('DELETE FROM candidate_accounts WHERE id = ANY($1)', [createdCandidateIds]);
  }
  await closePool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM otp_verification WHERE email = $1 OR phone = $2', [TEST_EMAIL, TEST_PHONE]);
});

async function seedKnownOtp(target: { email?: string; phone?: string }, otp: string, purpose: string) {
  const hash = await bcrypt.hash(otp, 10);
  await pool.query(
    `INSERT INTO otp_verification (email, phone, purpose, otp_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [target.email || null, target.phone || null, purpose, hash, new Date(Date.now() + 10 * 60 * 1000)]
  );
}

describe('POST /api/candidate-auth/register/start', () => {
  it('rejects a missing name or identifier', async () => {
    const res = await request(app).post('/api/candidate-auth/register/start').send({ identifier: TEST_EMAIL });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid identifier', async () => {
    const res = await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: 'not-an-email-or-phone' });
    expect(res.status).toBe(400);
  });

  it('creates a real, hashed otp_verification row for a new email identifier', async () => {
    const res = await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: TEST_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.identifier_type).toBe('email');

    const row = await pool.query("SELECT * FROM otp_verification WHERE email = $1 AND purpose = 'candidate_signup'", [TEST_EMAIL]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].verified).toBe(false);
    expect(row.rows[0].otp_hash).not.toMatch(/^\d{6}$/);
  });

  it('rejects registration for an identifier that already has an account', async () => {
    const passwordHash = await bcrypt.hash('Whatever9!', 10);
    const existing = await pool.query(
      `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
      ['Existing Candidate', 'batch8-existing@example.test', passwordHash]
    );
    createdCandidateIds.push(existing.rows[0].id);

    const res = await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: 'batch8-existing@example.test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already exists');
  });

  it('enforces the resend cooldown for the same identifier', async () => {
    await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: TEST_EMAIL });
    const second = await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: TEST_EMAIL });
    expect(second.status).toBe(429);
  });
});

describe('POST /api/candidate-auth/register/verify-otp', () => {
  it('rejects an incorrect OTP and increments attempts', async () => {
    await seedKnownOtp({ email: TEST_EMAIL }, '111111', 'candidate_signup');
    const res = await request(app).post('/api/candidate-auth/register/verify-otp').send({ identifier: TEST_EMAIL, otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Incorrect verification code');
  });

  it('accepts the correct OTP and marks it verified', async () => {
    await seedKnownOtp({ email: TEST_EMAIL }, '222222', 'candidate_signup');
    const res = await request(app).post('/api/candidate-auth/register/verify-otp').send({ identifier: TEST_EMAIL, otp: '222222' });
    expect(res.status).toBe(200);

    const row = await pool.query("SELECT verified FROM otp_verification WHERE email = $1 AND purpose = 'candidate_signup'", [TEST_EMAIL]);
    expect(row.rows[0].verified).toBe(true);
  });
});

describe('POST /api/candidate-auth/register/complete', () => {
  it('rejects completion if the OTP was never verified', async () => {
    await seedKnownOtp({ email: TEST_EMAIL }, '333333', 'candidate_signup');
    const res = await request(app).post('/api/candidate-auth/register/complete').send({
      name: TEST_NAME, identifier: TEST_EMAIL, password: TEST_PASSWORD, confirm_password: TEST_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Please verify your code first');
  });

  it('rejects mismatched password confirmation', async () => {
    await seedKnownOtp({ email: TEST_EMAIL }, '444444', 'candidate_signup');
    await request(app).post('/api/candidate-auth/register/verify-otp').send({ identifier: TEST_EMAIL, otp: '444444' });

    const res = await request(app).post('/api/candidate-auth/register/complete').send({
      name: TEST_NAME, identifier: TEST_EMAIL, password: TEST_PASSWORD, confirm_password: 'Different9!',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Passwords do not match');
  });

  it('completes registration end-to-end via email: creates the account, issues a session, and blocks re-registration of the same identifier', async () => {
    await seedKnownOtp({ email: TEST_EMAIL }, '555555', 'candidate_signup');
    const verifyRes = await request(app).post('/api/candidate-auth/register/verify-otp').send({ identifier: TEST_EMAIL, otp: '555555' });
    expect(verifyRes.status).toBe(200);

    const res = await request(app).post('/api/candidate-auth/register/complete').send({
      name: TEST_NAME, identifier: TEST_EMAIL, password: TEST_PASSWORD, confirm_password: TEST_PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.candidate.email).toBe(TEST_EMAIL);
    expect(res.body.candidate.name).toBe(TEST_NAME);
    expect(res.body.access_token).toBeTruthy();
    createdCandidateIds.push(res.body.candidate.id);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('candidate_access_token='))).toBe(true);

    const otpRows = await pool.query("SELECT * FROM otp_verification WHERE email = $1 AND purpose = 'candidate_signup'", [TEST_EMAIL]);
    expect(otpRows.rows).toHaveLength(0);

    const reregister = await request(app).post('/api/candidate-auth/register/start').send({ name: TEST_NAME, identifier: TEST_EMAIL });
    expect(reregister.status).toBe(400);
  });

  it('completes registration end-to-end via a phone identifier (+917207179473) - no real SMS is sent since Twilio is not configured in this environment', async () => {
    await seedKnownOtp({ phone: TEST_PHONE }, '666666', 'candidate_signup');
    const verifyRes = await request(app).post('/api/candidate-auth/register/verify-otp').send({ identifier: TEST_PHONE, otp: '666666' });
    expect(verifyRes.status).toBe(200);

    const res = await request(app).post('/api/candidate-auth/register/complete').send({
      name: TEST_NAME, identifier: TEST_PHONE, password: TEST_PASSWORD, confirm_password: TEST_PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.candidate.phone).toBe(TEST_PHONE);
    createdCandidateIds.push(res.body.candidate.id);
  });
});
