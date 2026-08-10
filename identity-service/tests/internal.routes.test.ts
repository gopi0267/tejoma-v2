/**
 * Integration tests for Batch 11's internal service-to-service endpoints - real HTTP, real
 * Identity DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_EMAIL = 'batch11-internal-user@example.test';
const TEST_COMPANY_ID = 999011;
const createdUserIds: number[] = [];

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.query('DELETE FROM users WHERE email = $1', [TEST_EMAIL]);
  await closePool();
});

describe('GET /internal/users/exists', () => {
  it('rejects a request with neither email nor phone', async () => {
    const res = await request(app).get('/internal/users/exists');
    expect(res.status).toBe(422);
  });

  it('returns false for an unknown email', async () => {
    const res = await request(app).get('/internal/users/exists').query({ email: TEST_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });
});

describe('POST /internal/users', () => {
  it('rejects invalid input', async () => {
    const res = await request(app).post('/internal/users').send({ name: '' });
    expect(res.status).toBe(422);
  });

  it('creates a staff user and never returns the password hash', async () => {
    const res = await request(app).post('/internal/users').send({
      name: 'Batch11 Internal User',
      email: TEST_EMAIL,
      passwordHash: '$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfakeh',
      companyId: TEST_COMPANY_ID,
      role: 'admin',
      createdBy: null,
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body.role).toBe('admin');
    expect(res.body.company_id).toBe(TEST_COMPANY_ID);
    expect(res.body).not.toHaveProperty('password_hash');
    createdUserIds.push(res.body.id);
  });

  it('now confirms the user exists via the exists endpoint', async () => {
    const res = await request(app).get('/internal/users/exists').query({ email: TEST_EMAIL });
    expect(res.body.exists).toBe(true);
  });

  it('rejects creating a duplicate user for the same email', async () => {
    const res = await request(app).post('/internal/users').send({
      name: 'Batch11 Internal User Dup',
      email: TEST_EMAIL,
      passwordHash: '$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfakeh',
      companyId: TEST_COMPANY_ID,
      role: 'admin',
    });
    expect(res.status).toBe(409);
  });
});

describe('GET /internal/candidates/last-active (Remaining-monolith migration, Step 5)', () => {
  const TEST_CANDIDATE_EMAIL = 'batch11-last-active-candidate@example.test';
  const TOKEN_HASH = 'batch11-test-token-hash';
  let TEST_CANDIDATE_ID: number;

  beforeAll(async () => {
    await pool.query('DELETE FROM candidate_accounts WHERE email = $1', [TEST_CANDIDATE_EMAIL]);
    const candidate = await pool.query(
      `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Last Active Test', $1, 'hashed', true) RETURNING id`,
      [TEST_CANDIDATE_EMAIL]
    );
    TEST_CANDIDATE_ID = candidate.rows[0].id;
    await pool.query('DELETE FROM candidate_refresh_tokens WHERE token_hash = $1', [TOKEN_HASH]);
    await pool.query(
      `INSERT INTO candidate_refresh_tokens (candidate_id, token_hash, user_agent, ip_address, expires_at, remember)
       VALUES ($1, $2, 'test-agent', '127.0.0.1', NOW() + INTERVAL '30 days', false)`,
      [TEST_CANDIDATE_ID, TOKEN_HASH]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM candidate_refresh_tokens WHERE token_hash = $1', [TOKEN_HASH]);
    await pool.query('DELETE FROM candidate_accounts WHERE email = $1', [TEST_CANDIDATE_EMAIL]);
  });

  it('returns an empty object for an empty ids param', async () => {
    const res = await request(app).get('/internal/candidates/last-active').query({ ids: '' });
    expect(res.status).toBe(200);
    expect(res.body.lastActive).toEqual({});
  });

  it('returns the most recent session timestamp for a known candidate id, keyed by id', async () => {
    const res = await request(app).get('/internal/candidates/last-active').query({ ids: String(TEST_CANDIDATE_ID) });
    expect(res.status).toBe(200);
    expect(res.body.lastActive).toHaveProperty(String(TEST_CANDIDATE_ID));
    expect(new Date(res.body.lastActive[TEST_CANDIDATE_ID]).getTime()).not.toBeNaN();
  });

  it('omits ids with no session history, without erroring', async () => {
    const res = await request(app).get('/internal/candidates/last-active').query({ ids: `${TEST_CANDIDATE_ID},999999999` });
    expect(res.status).toBe(200);
    expect(res.body.lastActive).toHaveProperty(String(TEST_CANDIDATE_ID));
    expect(res.body.lastActive).not.toHaveProperty('999999999');
  });
});
