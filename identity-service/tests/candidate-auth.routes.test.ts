/**
 * Integration tests for candidate auth routes - mirrors tests/auth.routes.test.ts's structure and
 * discipline exactly (real HTTP via supertest, real Identity DB, real bcrypt/JWT, seed-then-clean-up).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_EMAIL = 'batch5-test-candidate@example.test';
const TEST_PASSWORD = 'CorrectHorseBattery9!';

let testCandidateId: number;

beforeAll(async () => {
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id IN (SELECT id FROM candidate_accounts WHERE email = $1)', [TEST_EMAIL]);
  await pool.query('DELETE FROM candidate_accounts WHERE email = $1', [TEST_EMAIL]);

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const result = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    ['Batch 5 Test Candidate', TEST_EMAIL, passwordHash]
  );
  testCandidateId = result.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id = $1', [testCandidateId]);
  await pool.query("DELETE FROM audit_log WHERE actor_type = 'candidate' AND actor_id = $1", [testCandidateId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [testCandidateId]);
  await closePool();
});

describe('POST /api/candidate-auth/login', () => {
  it('rejects missing credentials', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unknown identifier without revealing account existence', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: 'nobody@example.test', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects the wrong password', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials and returns the auth-owned candidate fields, with profile fields present but null (Marketplace Service not yet built - documented Tier 0 boundary)', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.candidate.id).toBe(testCandidateId);
    expect(res.body.candidate.name).toBe('Batch 5 Test Candidate');
    expect(res.body.candidate.email).toBe(TEST_EMAIL);
    // The documented Tier 0 boundary from this batch's header comment, verified concretely:
    expect(res.body.candidate.headline).toBeNull();
    expect(res.body.candidate.skills).toEqual([]);
    expect(res.body.candidate.onboarding_completed_at).toBeNull();
    expect(res.body.access_token).toBeTruthy();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('candidate_access_token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('candidate_refresh_token='))).toBe(true);
  });

  it('rejects a deactivated account', async () => {
    await pool.query('UPDATE candidate_accounts SET is_active = false WHERE id = $1', [testCandidateId]);
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('This account has been deactivated');
    await pool.query('UPDATE candidate_accounts SET is_active = true WHERE id = $1', [testCandidateId]);
  });
});

describe('POST /api/candidate-auth/refresh, GET /api/candidate-auth/me, logout', () => {
  async function login(): Promise<{ accessCookie: string; refreshCookie: string }> {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return {
      accessCookie: cookies.find((c) => c.startsWith('candidate_access_token='))!.split(';')[0],
      refreshCookie: cookies.find((c) => c.startsWith('candidate_refresh_token='))!.split(';')[0],
    };
  }

  it('rejects /me with no session cookie', async () => {
    const res = await request(app).get('/api/candidate-auth/me');
    expect(res.status).toBe(401);
  });

  it('accepts /me with a valid candidate access token cookie, and it is NOT accepted by the staff-only cookie name', async () => {
    const { accessCookie } = await login();
    const res = await request(app).get('/api/candidate-auth/me').set('Cookie', accessCookie);
    expect(res.status).toBe(200);
    expect(res.body.candidate.email).toBe(TEST_EMAIL);

    // Confirm the two auth systems are genuinely isolated (Phase 1's confirmed structural
    // asymmetry) - a candidate cookie must not satisfy the staff /me endpoint.
    const staffMeAttempt = await request(app).get('/api/auth/me').set('Cookie', accessCookie.replace('candidate_access_token', 'access_token'));
    expect(staffMeAttempt.status).toBe(401);
  });

  it('rotates the refresh token and rejects reuse of the old one (theft detection, same as staff)', async () => {
    const { refreshCookie } = await login();
    const first = await request(app).post('/api/candidate-auth/refresh').set('Cookie', refreshCookie);
    expect(first.status).toBe(200);

    const reused = await request(app).post('/api/candidate-auth/refresh').set('Cookie', refreshCookie);
    expect(reused.status).toBe(401);
    expect(reused.body.error).toBe('Session invalid. Please log in again.');
  });

  it('logout-all revokes every session for the candidate', async () => {
    const session1 = await login();
    const session2 = await login();

    await request(app).post('/api/candidate-auth/logout-all').set('Cookie', session1.refreshCookie);

    const check1 = await request(app).post('/api/candidate-auth/refresh').set('Cookie', session1.refreshCookie);
    const check2 = await request(app).post('/api/candidate-auth/refresh').set('Cookie', session2.refreshCookie);
    expect(check1.status).toBe(401);
    expect(check2.status).toBe(401);
  });
});
