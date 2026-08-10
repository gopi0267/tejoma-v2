/**
 * Integration tests confirming security-relevant events actually land in audit_log (Batch 9) -
 * real HTTP through the real routes, real Identity DB, checking the table directly. Covers both
 * staff and candidate actor types, and the specific event this table exists to make investigable:
 * refresh-token-reuse (theft detection).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const STAFF_EMAIL = 'batch9-audit-staff@example.test';
const STAFF_PASSWORD = 'AuditStaff9!';
const CANDIDATE_EMAIL = 'batch9-audit-candidate@example.test';
const CANDIDATE_PASSWORD = 'AuditCandidate9!';

let staffUserId: number;
let candidateId: number;

beforeAll(async () => {
  await pool.query('DELETE FROM audit_log WHERE actor_id IN (SELECT id FROM users WHERE email = $1) OR actor_id IN (SELECT id FROM candidate_accounts WHERE email = $2)', [STAFF_EMAIL, CANDIDATE_EMAIL]);
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [STAFF_EMAIL]);
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id IN (SELECT id FROM candidate_accounts WHERE email = $1)', [CANDIDATE_EMAIL]);
  await pool.query('DELETE FROM users WHERE email = $1', [STAFF_EMAIL]);
  await pool.query('DELETE FROM candidate_accounts WHERE email = $1', [CANDIDATE_EMAIL]);

  const staffHash = await bcrypt.hash(STAFF_PASSWORD, 10);
  const staffResult = await pool.query(
    `INSERT INTO users (email, password_hash, company_id, role, is_active, name) VALUES ($1, $2, 999009, 'recruiter', true, 'Batch 9 Audit Staff') RETURNING id`,
    [STAFF_EMAIL, staffHash]
  );
  staffUserId = staffResult.rows[0].id;

  const candidateHash = await bcrypt.hash(CANDIDATE_PASSWORD, 10);
  const candidateResult = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
    ['Batch 9 Audit Candidate', CANDIDATE_EMAIL, candidateHash]
  );
  candidateId = candidateResult.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM audit_log WHERE actor_id = $1 AND actor_type = $2', [staffUserId, 'staff']);
  await pool.query('DELETE FROM audit_log WHERE actor_id = $1 AND actor_type = $2', [candidateId, 'candidate']);
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [staffUserId]);
  await pool.query('DELETE FROM candidate_refresh_tokens WHERE candidate_id = $1', [candidateId]);
  await pool.query('DELETE FROM users WHERE id = $1', [staffUserId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateId]);
  await closePool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM audit_log WHERE (actor_id = $1 AND actor_type = $3) OR (actor_id = $2 AND actor_type = $4)', [staffUserId, candidateId, 'staff', 'candidate']);
});

async function latestEvent(actorType: string, actorId: number | null, eventType: string) {
  const result = await pool.query(
    'SELECT * FROM audit_log WHERE actor_type = $1 AND event_type = $3 AND (actor_id = $2 OR ($2 IS NULL AND actor_id IS NULL)) ORDER BY created_at DESC LIMIT 1',
    [actorType, actorId, eventType]
  );
  return result.rows[0] || null;
}

describe('staff auth events', () => {
  it('records login_success with the correct actor', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: STAFF_EMAIL, password: STAFF_PASSWORD });
    expect(res.status).toBe(200);

    const event = await latestEvent('staff', staffUserId, 'login_success');
    expect(event).toBeTruthy();
    expect(event.ip_address).toBeTruthy();
  });

  it('records login_failed with a reason, and no actor_id for an unknown identifier', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: 'nobody-batch9@example.test', password: 'whatever' });
    expect(res.status).toBe(401);

    const event = await latestEvent('staff', null, 'login_failed');
    expect(event).toBeTruthy();
    expect(event.metadata.reason).toBe('unknown_identifier');
  });

  it('records login_failed with the real actor_id for a wrong password on a known account', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: STAFF_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);

    const event = await latestEvent('staff', staffUserId, 'login_failed');
    expect(event).toBeTruthy();
    expect(event.metadata.reason).toBe('wrong_password');
  });

  it('records refresh_token_reuse_detected when a rotated token is replayed', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: STAFF_EMAIL, password: STAFF_PASSWORD });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie); // rotates - this cookie is now revoked
    const reused = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie); // replay the now-revoked token
    expect(reused.status).toBe(401);

    const event = await latestEvent('staff', staffUserId, 'refresh_token_reuse_detected');
    expect(event).toBeTruthy();
  });

  it('records logout with the correct actor', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: STAFF_EMAIL, password: STAFF_PASSWORD });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token='))!.split(';')[0];

    await request(app).post('/api/auth/logout').set('Cookie', refreshCookie);
    const event = await latestEvent('staff', staffUserId, 'logout');
    expect(event).toBeTruthy();
  });
});

describe('candidate auth events', () => {
  it('records login_success with the correct actor', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: CANDIDATE_EMAIL, password: CANDIDATE_PASSWORD });
    expect(res.status).toBe(200);

    const event = await latestEvent('candidate', candidateId, 'login_success');
    expect(event).toBeTruthy();
  });

  it('records login_failed for a wrong password', async () => {
    const res = await request(app).post('/api/candidate-auth/login').send({ identifier: CANDIDATE_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);

    const event = await latestEvent('candidate', candidateId, 'login_failed');
    expect(event).toBeTruthy();
    expect(event.metadata.reason).toBe('wrong_password');
  });

  it('records refresh_token_reuse_detected when a rotated candidate token is replayed', async () => {
    const loginRes = await request(app).post('/api/candidate-auth/login').send({ identifier: CANDIDATE_EMAIL, password: CANDIDATE_PASSWORD });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('candidate_refresh_token='))!.split(';')[0];

    await request(app).post('/api/candidate-auth/refresh').set('Cookie', refreshCookie);
    const reused = await request(app).post('/api/candidate-auth/refresh').set('Cookie', refreshCookie);
    expect(reused.status).toBe(401);

    const event = await latestEvent('candidate', candidateId, 'refresh_token_reuse_detected');
    expect(event).toBeTruthy();
  });
});
