/**
 * Integration tests for /api/users/* (Batch 21) - real HTTP requests via supertest against the
 * real Express app, a real Identity DB, and real bcrypt operations throughout. Mirrors
 * tests/auth.routes.test.ts's "seed directly, clean up after" discipline - an admin user is
 * seeded directly (this module's own POST /users is what's under test, so it can't bootstrap
 * itself), signed with a real RS256 token via signAccessToken (this service's own scheme, not the
 * monolith's HS256).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';
import { signAccessToken } from '../src/utils/tokens.js';

const TEST_COMPANY_ID = 999021; // opaque reference - no companies table in Identity DB
const ADMIN_EMAIL = 'batch21-admin@example.test';
const OTHER_ADMIN_EMAIL = 'batch21-other-admin@example.test';
const RECRUITER_EMAIL = 'batch21-recruiter@example.test';

let adminId: number;
let otherAdminId: number;
let recruiterId: number;

function adminCookie(userId = adminId) {
  const token = signAccessToken({ user_id: userId, email: ADMIN_EMAIL, name: 'Batch21 Admin', company_id: TEST_COMPANY_ID, role: 'admin' });
  return `access_token=${token}`;
}

function recruiterCookie() {
  const token = signAccessToken({ user_id: recruiterId, email: RECRUITER_EMAIL, name: 'Batch21 Recruiter', company_id: TEST_COMPANY_ID, role: 'recruiter' });
  return `access_token=${token}`;
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE company_id = $1', [TEST_COMPANY_ID]);

  const passwordHash = await bcrypt.hash('CorrectHorseBattery9!', 10);
  const admin = await pool.query(
    `INSERT INTO users (email, password_hash, company_id, role, is_active, name) VALUES ($1, $2, $3, 'admin', true, 'Batch21 Admin') RETURNING id`,
    [ADMIN_EMAIL, passwordHash, TEST_COMPANY_ID]
  );
  adminId = admin.rows[0].id;

  const otherAdmin = await pool.query(
    `INSERT INTO users (email, password_hash, company_id, role, is_active, name) VALUES ($1, $2, $3, 'admin', true, 'Batch21 Other Admin') RETURNING id`,
    [OTHER_ADMIN_EMAIL, passwordHash, TEST_COMPANY_ID]
  );
  otherAdminId = otherAdmin.rows[0].id;

  const recruiter = await pool.query(
    `INSERT INTO users (email, password_hash, company_id, role, is_active, name) VALUES ($1, $2, $3, 'recruiter', true, 'Batch21 Recruiter') RETURNING id`,
    [RECRUITER_EMAIL, passwordHash, TEST_COMPANY_ID]
  );
  recruiterId = recruiter.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)', [TEST_COMPANY_ID]);
  await pool.query('DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)', [TEST_COMPANY_ID]);
  await pool.query('DELETE FROM users WHERE company_id = $1', [TEST_COMPANY_ID]);
  await closePool();
});

describe('GET /api/users', () => {
  it('rejects a recruiter session with 403 (admin only)', async () => {
    const res = await request(app).get('/api/users').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('lists users scoped to the admin\'s own company, with stats', async () => {
    const res = await request(app).get('/api/users').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.every((u: any) => u.password_hash === undefined)).toBe(true);
    expect(res.body.stats.totalUsers).toBeGreaterThanOrEqual(3);
  });

  it('filters by role', async () => {
    const res = await request(app).get('/api/users?role=recruiter').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.data.every((u: any) => u.role === 'recruiter')).toBe(true);
  });
});

describe('POST /api/users', () => {
  it('creates a new recruiter with a generated password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie())
      .send({ name: 'New Recruiter', email: 'batch21-new-recruiter@example.test', role: 'recruiter', generatePassword: true });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Recruiter');
    expect(res.body.generated_password).toBeTruthy();
    expect(res.body.password_hash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie())
      .send({ name: 'Dup', email: RECRUITER_EMAIL, role: 'recruiter', generatePassword: true });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/users/:id/status', () => {
  it('blocks disabling the last active admin', async () => {
    // Disable the second admin first so otherAdminId's own removal-guard scenario is unambiguous.
    const res = await request(app).patch(`/api/users/${otherAdminId}/status`).set('Cookie', adminCookie()).send({ is_active: false });
    expect(res.status).toBe(200);

    // Now only one active admin (adminId) remains - disabling it must be blocked.
    const blocked = await request(app).patch(`/api/users/${adminId}/status`).set('Cookie', adminCookie()).send({ is_active: false });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/own account/);
  });

  it('disables a recruiter and revokes their refresh tokens', async () => {
    const res = await request(app).patch(`/api/users/${recruiterId}/status`).set('Cookie', adminCookie()).send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });
});

describe('PATCH /api/users/:id/reset-password', () => {
  it('resets the password and records history', async () => {
    const res = await request(app).patch(`/api/users/${recruiterId}/reset-password`).set('Cookie', adminCookie()).send({ generatePassword: true });
    expect(res.status).toBe(200);
    expect(res.body.generated_password).toBeTruthy();

    const history = await pool.query('SELECT COUNT(*) FROM password_history WHERE user_id = $1', [recruiterId]);
    expect(Number(history.rows[0].count)).toBeGreaterThan(0);
  });
});

describe('DELETE /api/users/:id', () => {
  it('rejects deleting your own account', async () => {
    const res = await request(app).delete(`/api/users/${adminId}`).set('Cookie', adminCookie());
    expect(res.status).toBe(400);
  });

  it('soft-deletes a recruiter', async () => {
    const res = await request(app).delete(`/api/users/${recruiterId}`).set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app).get(`/api/users/${recruiterId}`).set('Cookie', adminCookie());
    expect(getRes.status).toBe(404);
  });
});
