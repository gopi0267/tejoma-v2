/**
 * Integration tests for /api/analytics/* - real HTTP against a real, minimal stand-in for the
 * monolith's /internal/analytics/* API (tests/helpers/mockMonolith.ts), proving the full chain:
 * staff auth verified locally, request forwarded to the monolith, response passed through, and
 * upstream failures turned into a clean 502 rather than a crash. Mirrors recruiting-service's
 * tests/matches.routes.test.ts approach.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 501, email: 'r@tejoma.com', name: 'Recruiter', company_id: 601, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
});

describe('GET /api/analytics/dashboard', () => {
  it('rejects unauthenticated requests before ever calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/analytics/dashboard');
    expect(res.status).toBe(401);
    expect(monolith.received.length).toBe(beforeCount);
  });

  it('forwards companyId from the session and returns the upstream body unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { total_reviewed: 10, matches_made: 3, avg_score: 72.5 } };
    const res = await request(app).get('/api/analytics/dashboard').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total_reviewed: 10, matches_made: 3, avg_score: 72.5 });
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('companyId=601');
  });
});

describe('GET /api/analytics/job/:job_id', () => {
  it('rejects a non-numeric id without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/analytics/job/abc').set('Cookie', recruiterCookie());
    expect(res.status).toBe(400);
    expect(monolith.received.length).toBe(beforeCount);
  });

  it('returns 404 when the monolith reports the job as not found', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 404, body: { error: 'Job not found' } };
    const res = await request(app).get('/api/analytics/job/999').set('Cookie', recruiterCookie());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/analytics/recruiter/me', () => {
  it("forwards the caller's own user_id, never a client-supplied one", async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { id: 501, name: 'Recruiter', swipesCount: 12 } };
    const res = await request(app).get('/api/analytics/recruiter/me').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('userId=501');
  });
});

describe('GET /api/analytics/skills', () => {
  it('reshapes the upstream skillDistribution into {skill, count} pairs', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { skillDistribution: [{ name: 'React', value: 5 }] } };
    const res = await request(app).get('/api/analytics/skills').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ skill: 'React', count: 5 }]);
  });
});

describe('upstream failure handling', () => {
  it('returns 502 when the monolith is unreachable, without crashing the service', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    const res = await request(appWithDeadMonolith).get('/api/analytics/dashboard').set('Cookie', recruiterCookie());
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});
