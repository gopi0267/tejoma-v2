/**
 * Integration tests for the public, gateway-routed /api/candidates* surface (remaining-monolith
 * migration, Step 3a). GET routes: real HTTP against a real database seeded directly, confirming
 * the mapRowToCandidate parsing (skills/previous_companies/certifications as real arrays, matching
 * the monolith's original response shape). POST/DELETE/bulk routes: real HTTP against a real,
 * minimal stand-in for the monolith's /internal/candidate-core/* API (tests/helpers/mockMonolith.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

// Loaded directly (not via config/env.js) so process.env is populated before db.js's/server.js's
// own module-level code runs, without prematurely locking in config/env.js's own exported
// constants (JWT_SECRET, MONOLITH_INTERNAL_URL) before this file gets a chance to override them
// below - both db.js and server.js are imported dynamically in beforeAll, after that override.
config({ path: '.env.local' });

const DEV_SECRET = process.env.JWT_SECRET!;
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 501, email: 'r@tejoma.com', name: 'Recruiter', company_id: 850, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const candidateCookie = () => `access_token=${jwt.sign({ user_id: 900, email: 'c@tejoma.com', name: 'Candidate', company_id: 850, role: 'candidate' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let pool: import('pg').Pool;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;

  ({ pool } = await import('../src/db.js'));
  ({ app } = await import('../src/server.js'));

  await pool.query(
    `INSERT INTO candidates (id, company_id, name, email, skills, previous_companies, certifications)
     VALUES (900601, 850, 'Jane Doe', 'jane2@example.test', 'TypeScript, React', 'Acme Inc; Foo Corp', 'AWS Certified; PMP')`
  );
});

afterAll(async () => {
  await monolith.close();
  await pool.query('DELETE FROM candidates WHERE id = 900601');
  await pool.end();
});

describe('auth gating', () => {
  it('rejects with no token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidates');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate role (staff-only surface)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidates').set('Cookie', candidateCookie());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/candidates', () => {
  it('returns candidates parsed into real arrays (not raw delimited strings)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidates').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    const jane = res.body.find((c: any) => c.id === 900601);
    expect(jane.skills).toEqual(['TypeScript', 'React']);
    expect(jane.previous_companies).toEqual(['Acme Inc', 'Foo Corp']);
    expect(jane.certifications).toEqual(['AWS Certified', 'PMP']);
  });
});

describe('GET /api/candidates/:id', () => {
  it('returns 404 for a candidate scoped to a different company', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidates/900601').set('Cookie', `access_token=${jwt.sign({ user_id: 1, email: 'x@tejoma.com', name: 'X', company_id: 999, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`);
    expect(res.status).toBe(404);
  });

  it('returns a real candidate with parsed fields', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidates/900601').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual(['TypeScript', 'React']);
  });
});

describe('POST /api/candidates (real cutover - write-cutover completion plan, Phase A)', () => {
  const createdIds: number[] = [];
  afterAll(async () => {
    if (createdIds.length > 0) await pool.query('DELETE FROM candidates WHERE id = ANY($1)', [createdIds]);
  });

  it('requires name and email before writing anything', async () => {
    const request = (await import('supertest')).default;
    // Scoped to this test's own company_id (850), not a whole-table count - other test files in
    // this suite run in parallel and seed/clean up their own rows concurrently.
    const countForCompany = () => pool.query('SELECT COUNT(*)::int AS c FROM candidates WHERE company_id = $1', [850]).then((r) => r.rows[0].c);
    const beforeCount = await countForCompany();
    const res = await request(app).post('/api/candidates').set('Cookie', recruiterCookie()).send({ name: 'No Email' });
    expect(res.status).toBe(400);
    expect(await countForCompany()).toBe(beforeCount);
  });

  it('writes a real row to this service’s own database, parses the response, and mirrors it to the monolith', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/candidate-core/candidates/mirror-and-notify'] = { status: 200, body: { mirrored: true } };
    const res = await request(app).post('/api/candidates').set('Cookie', recruiterCookie()).send({ name: 'New Candidate', email: 'new@example.test', skills: 'Go, Rust' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Candidate');
    expect(res.body.skills).toEqual(['Go', 'Rust']);
    createdIds.push(res.body.id);

    const row = await pool.query('SELECT * FROM candidates WHERE id = $1', [res.body.id]);
    expect(row.rows[0].email).toBe('new@example.test');
    expect(row.rows[0].skills).toBe('Go, Rust'); // stored as a delimited string, matching the monolith's own convention

    const mirrorCall = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/candidate-core/candidates/mirror-and-notify').at(-1)!;
    const sentCandidate = JSON.parse(mirrorCall.body).candidate;
    expect(sentCandidate.id).toBe(res.body.id);
    expect(sentCandidate.skills).toBe('Go, Rust'); // the raw row, not the parsed response shape
    delete monolith.responses['/internal/candidate-core/candidates/mirror-and-notify'];
  });

  it('still succeeds when the monolith is unreachable - the mirror is best-effort, not required for success', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.MONOLITH_INTERNAL_URL;
    process.env.MONOLITH_INTERNAL_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');
    const { pool: poolWithDeadMonolith } = await import('../src/db.js');

    const res = await request(appWithDeadMonolith).post('/api/candidates').set('Cookie', recruiterCookie()).send({ name: 'Mirror Fails', email: 'mirror-fails@example.test' });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    const row = await poolWithDeadMonolith.query('SELECT id FROM candidates WHERE id = $1', [res.body.id]);
    expect(row.rows).toHaveLength(1);

    process.env.MONOLITH_INTERNAL_URL = originalUrl;
  });
});

describe('DELETE /api/candidates/:id (real cutover - write-cutover completion plan, Phase A)', () => {
  it('deletes the real row and mirrors the deletion to the monolith', async () => {
    const request = (await import('supertest')).default;
    const seeded = await pool.query(
      `INSERT INTO candidates (company_id, name, email) VALUES (850, 'To Delete', 'delete-me@example.test') RETURNING id`
    );
    const id = seeded.rows[0].id;
    monolith.responses['/internal/candidate-core/candidates/mirror-delete'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).delete(`/api/candidates/${id}`).set('Cookie', recruiterCookie());
    expect(res.status).toBe(204);

    const row = await pool.query('SELECT id FROM candidates WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(0);

    const mirrorCall = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/candidate-core/candidates/mirror-delete').at(-1)!;
    expect(JSON.parse(mirrorCall.body)).toEqual({ id, companyId: 850 });
    delete monolith.responses['/internal/candidate-core/candidates/mirror-delete'];
  });

  it('returns 404 for a candidate that does not exist locally, without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).delete('/api/candidates/999999999').set('Cookie', recruiterCookie());
    expect(res.status).toBe(404);
    expect(monolith.received.length).toBe(beforeCount);
  });
});
