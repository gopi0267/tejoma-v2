/**
 * Integration tests for the proxy routes (candidate-jobs, candidate-decisions,
 * candidate-applications, candidate-matches) - real HTTP against a real, minimal stand-in for the
 * monolith's /internal/candidate/* API (tests/helpers/mockMonolith.ts), proving the full chain:
 * candidate auth verified locally, request forwarded to the monolith with the right query
 * params/body, response passed through, and upstream failures turned into a clean 502 rather than
 * a crash. Mirrors api-gateway/tests/proxy.routing.test.ts's approach.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const authCookie = () => `candidate_access_token=${jwt.sign({ candidate_id: 7, email: 'jane@example.test', phone: null, name: 'Jane Doe' }, DEV_SECRET, { expiresIn: '15m' })}`;

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

describe('GET /api/candidate-jobs', () => {
  it('forwards search params and the candidate id, returns the upstream body unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { jobs: [{ id: 1, title: 'Engineer' }], total: 1 } };
    const res = await request(app).get('/api/candidate-jobs?search=engineer').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobs: [{ id: 1, title: 'Engineer' }], total: 1 });
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('candidateAccountId=7');
    expect(received.url).toContain('search=engineer');
  });

  it('rejects unauthenticated requests before ever calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/candidate-jobs');
    expect(res.status).toBe(401);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('GET /api/candidate-jobs/:id', () => {
  it('returns 404 when the monolith reports the job as not found', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 404, body: { error: 'Job not found' } };
    const res = await request(app).get('/api/candidate-jobs/999').set('Cookie', authCookie());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Job not found');
  });

  it('rejects a non-numeric id without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/candidate-jobs/abc').set('Cookie', authCookie());
    expect(res.status).toBe(400);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('POST /api/candidate-decisions', () => {
  it('forwards the decision with the candidate id attached', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 201, body: { decision: { id: 1, action: 1 } } };
    const res = await request(app).post('/api/candidate-decisions').set('Cookie', authCookie()).send({ job_id: 42, decision_type: 'swipe_right' });
    expect(res.status).toBe(201);
    expect(res.body.decision.id).toBe(1);
    const received = monolith.received.at(-1)!;
    expect(JSON.parse(received.body)).toEqual({ candidateAccountId: 7, job_id: 42, decision_type: 'swipe_right' });
  });

  it('rejects an invalid decision_type without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).post('/api/candidate-decisions').set('Cookie', authCookie()).send({ job_id: 42, decision_type: 'bogus' });
    expect(res.status).toBe(400);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('GET /api/candidate-applications and /api/candidate-matches', () => {
  it('forwards applications list requests', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { applications: [] } };
    const res = await request(app).get('/api/candidate-applications').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ applications: [] });
  });

  it('forwards matches list requests', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { matches: [] } };
    const res = await request(app).get('/api/candidate-matches').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matches: [] });
  });
});

describe('GET /api/candidate-analytics (remaining-monolith migration, Step 3c)', () => {
  it('forwards the candidate id and returns the upstream body unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 200, body: { averageMatchScore: 78, funnel: { liked: 3 } } };
    const res = await request(app).get('/api/candidate-analytics').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ averageMatchScore: 78, funnel: { liked: 3 } });
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('candidateAccountId=7');
  });

  it('rejects unauthenticated requests before ever calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/candidate-analytics');
    expect(res.status).toBe(401);
    expect(monolith.received.length).toBe(beforeCount);
  });

  it('returns 404 when the monolith reports the candidate as not found', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = { status: 404, body: { error: 'Candidate not found' } };
    const res = await request(app).get('/api/candidate-analytics').set('Cookie', authCookie());
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Candidate not found');
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

    const res = await request(appWithDeadMonolith).get('/api/candidate-matches').set('Cookie', authCookie());
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});
