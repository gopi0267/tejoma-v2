/**
 * Integration tests for GET /api/matches - real HTTP against a real, minimal stand-in for the
 * monolith's /internal/recruiting/* API (tests/helpers/mockMonolith.ts), proving the full chain:
 * staff auth verified locally, request forwarded to the monolith with the right query params,
 * response passed through, and upstream failures turned into a clean 502 rather than a crash.
 * Mirrors candidate-service's tests/proxyRoutes.test.ts approach.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const authCookie = () => `access_token=${jwt.sign({ user_id: 501, email: 'r@tejoma.com', name: 'Recruiter', company_id: 601, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.RECRUITER_MATCHES_CUTOVER_ENABLED = 'false'; // Disable cutover for monolith proxy tests
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
});

describe('GET /api/matches', () => {
  it('rejects unauthenticated requests before ever calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(401);
    expect(monolith.received.length).toBe(beforeCount);
  });

  it('forwards companyId and userId from the authenticated session, returns the upstream body unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { matches: [{ id: 1, job_title: 'Engineer' }] } };
    const res = await request(app).get('/api/matches').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [{ id: 1, job_title: 'Engineer' }] });
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('companyId=601');
    expect(received.url).toContain('userId=501');
  });

  it('forwards an optional job_id filter', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { matches: [] } };
    await request(app).get('/api/matches?job_id=42').set('Cookie', authCookie());
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('jobId=42');
  });

  it('returns 502 when the monolith is unreachable, without crashing the service', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    const res = await request(appWithDeadMonolith).get('/api/matches').set('Cookie', authCookie());
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});
