/**
 * Integration tests for staff auth routes - real HTTP requests via supertest against the real
 * Express app, a real Identity DB (whatever DB_* env vars the test run supplies - never mocked),
 * and real bcrypt/JWT operations throughout. A dedicated test user is seeded directly (bypassing
 * the API, since signup isn't built until a later batch) and cleaned up after every test file run
 * - the same "seed directly, clean up after" discipline this codebase's own prior verification
 * work has used throughout this series.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_EMAIL = 'batch4-test-recruiter@example.test';
const TEST_PASSWORD = 'CorrectHorseBattery9!';
const TEST_COMPANY_ID = 999001; // opaque reference - no companies table in Identity DB (Phase 3(database) section 4)

let testUserId: number;

beforeAll(async () => {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [TEST_EMAIL]);
  await pool.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, company_id, role, is_active, name)
     VALUES ($1, $2, $3, 'recruiter', true, 'Batch 4 Test Recruiter') RETURNING id`,
    [TEST_EMAIL, passwordHash, TEST_COMPANY_ID]
  );
  testUserId = result.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [testUserId]);
  await pool.query("DELETE FROM audit_log WHERE actor_type = 'staff' AND actor_id = $1", [testUserId]);
  await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  await closePool();
});

describe('POST /api/auth/login', () => {
  it('rejects missing credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an unknown identifier without revealing whether the account exists', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: 'nobody@example.test', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects a correct identifier with the wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: TEST_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('logs in with correct credentials, returns user_info + company_id, and sets both cookies', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user_info).toEqual({ id: testUserId, name: 'Batch 4 Test Recruiter', email: TEST_EMAIL, role: 'recruiter' });
    expect(res.body.company_id).toBe(TEST_COMPANY_ID);
    // Company enrichment is null until Tenant Directory Service exists (Batch 4's documented,
    // tracked deferral) - not a bug, the expected state right now.
    expect(res.body.company).toBeNull();
    expect(res.body.access_token).toBeTruthy();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('supports the legacy "email" field name alongside "identifier"', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('persists a real refresh_tokens row with device/IP tracking on login', async () => {
    await request(app).post('/api/auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD }).set('User-Agent', 'vitest-integration-test');
    const rows = await pool.query('SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [testUserId]);
    expect(rows.rows[0].user_agent).toBe('vitest-integration-test');
    expect(rows.rows[0].revoked_at).toBeNull();
  });

  it('rejects a deactivated account even with the correct password', async () => {
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [testUserId]);
    const res = await request(app).post('/api/auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('This account has been deactivated');
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [testUserId]);
  });
});

describe('POST /api/auth/refresh, GET /api/auth/me, POST /api/auth/logout', () => {
  async function login(): Promise<{ accessCookie: string; refreshCookie: string }> {
    const res = await request(app).post('/api/auth/login').send({ identifier: TEST_EMAIL, password: TEST_PASSWORD });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return {
      accessCookie: cookies.find((c) => c.startsWith('access_token='))!.split(';')[0],
      refreshCookie: cookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0],
    };
  }

  it('rejects /me with no session cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('accepts /me with a valid access token cookie', async () => {
    const { accessCookie } = await login();
    const res = await request(app).get('/api/auth/me').set('Cookie', accessCookie);
    expect(res.status).toBe(200);
    expect(res.body.user_info.email).toBe(TEST_EMAIL);
  });

  it('rejects a refresh with no refresh token cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token: the old token is revoked, a new one is issued, and reusing the old one is rejected', async () => {
    const { refreshCookie } = await login();

    const first = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(first.status).toBe(200);
    const newCookies = first.headers['set-cookie'] as unknown as string[];
    const newRefreshCookie = newCookies.find((c) => c.startsWith('refresh_token='))!.split(';')[0];
    expect(newRefreshCookie).not.toBe(refreshCookie);

    // Reusing the now-rotated original token is theft-signal behavior: reject AND revoke every
    // session for this user (Phase 2(original) section 9's rule, restated in Batch 2's
    // refreshTokenRotation.ts and now exercised end-to-end here for the first time).
    const reused = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(reused.status).toBe(401);
    expect(reused.body.error).toBe('Session invalid. Please log in again.');

    // Confirm the theft-detection side effect: even the brand-new token issued a moment ago is
    // now revoked too.
    const afterTheft = await request(app).post('/api/auth/refresh').set('Cookie', newRefreshCookie);
    expect(afterTheft.status).toBe(401);
  });

  it('logout revokes the current session only', async () => {
    const { refreshCookie } = await login();
    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie);
    expect(logoutRes.status).toBe(200);

    const afterLogout = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(afterLogout.status).toBe(401);
  });

  it('logout-all revokes every session for the user', async () => {
    const session1 = await login();
    const session2 = await login();

    await request(app).post('/api/auth/logout-all').set('Cookie', session1.refreshCookie);

    const check1 = await request(app).post('/api/auth/refresh').set('Cookie', session1.refreshCookie);
    const check2 = await request(app).post('/api/auth/refresh').set('Cookie', session2.refreshCookie);
    expect(check1.status).toBe(401);
    expect(check2.status).toBe(401);
  });
});
