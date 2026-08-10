/**
 * Integration tests for /ml/config, /ml/train, /ml/model/status, /ml/model/versions - real HTTP
 * against a real, minimal stand-in for the monolith's /internal/matching-scoring/* API
 * (tests/helpers/mockMonolith.ts), and real JWT verification (same HS256 dev secret every other
 * Tier 0 service's tests sign against).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const adminCookie = () => `access_token=${jwt.sign({ user_id: 501, email: 'admin@tejoma.com', name: 'Admin', company_id: 701, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`;
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 502, email: 'r@tejoma.com', name: 'Recruiter', company_id: 701, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const candidateCookie = () => `access_token=${jwt.sign({ user_id: 900, email: 'c@tejoma.com', name: 'Candidate', company_id: 701, role: 'candidate' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable, not exercised by these routes
  const { config } = await import('dotenv');
  config({ path: '.env.local', override: false });
  process.env.JWT_SECRET = DEV_SECRET;
  const { app: builtApp } = await import('../src/server.js');
  app = builtApp;
});

afterAll(async () => {
  await monolith.close();
});

describe('auth gating', () => {
  it('rejects GET /ml/config with no token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/ml/config');
    expect(res.status).toBe(401);
  });

  it('rejects POST /ml/config from a candidate role', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/ml/config').set('Cookie', candidateCookie()).send({ activeModelType: 'heuristic' });
    expect(res.status).toBe(403);
  });

  it('rejects POST /ml/config from a recruiter role (admin-only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/ml/config').set('Cookie', recruiterCookie()).send({ activeModelType: 'heuristic' });
    expect(res.status).toBe(403);
  });

  it('allows GET /ml/config for a recruiter role', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/model-config'] = { status: 200, body: { activeModelType: 'random_forest', isRetrainingInProgress: false, lastTrainingTimestamp: '2026-01-01T00:00:00.000Z' } };
    const res = await request(app).get('/api/ml/config').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
  });
});

describe('GET /ml/config', () => {
  it('proxies the monolith real config and forwards it unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/model-config'] = { status: 200, body: { activeModelType: 'hybrid_weighted', isRetrainingInProgress: false, lastTrainingTimestamp: '2026-02-02T00:00:00.000Z' } };
    const res = await request(app).get('/api/ml/config').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeModelType: 'hybrid_weighted', isRetrainingInProgress: false, lastTrainingTimestamp: '2026-02-02T00:00:00.000Z' });
    expect(monolith.received.some((r) => r.url === '/internal/matching-scoring/model-config')).toBe(true);
  });
});

describe('POST /ml/config', () => {
  it('rejects an invalid activeModelType before calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const before = monolith.received.length;
    const res = await request(app).post('/api/ml/config').set('Cookie', adminCookie()).send({ activeModelType: 'not-a-real-type' });
    expect(res.status).toBe(400);
    expect(monolith.received.length).toBe(before);
  });

  it('forwards a valid activeModelType to the monolith and relays its response', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/model-config'] = { status: 200, body: { activeModelType: 'ml_tree', isRetrainingInProgress: false, lastTrainingTimestamp: '2026-03-03T00:00:00.000Z' } };
    const res = await request(app).post('/api/ml/config').set('Cookie', adminCookie()).send({ activeModelType: 'ml_tree' });
    expect(res.status).toBe(200);
    expect(res.body.activeModelType).toBe('ml_tree');
    const posted = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/matching-scoring/model-config').at(-1)!;
    expect(JSON.parse(posted.body)).toEqual({ activeModelType: 'ml_tree' });
  });
});

describe('POST /ml/train', () => {
  it('requires admin role', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/ml/train').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('proxies to the monolith and relays a real training result', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/train'] = {
      status: 200,
      body: { success: true, activeModelType: 'random_forest', isRetrainingInProgress: false, lastTrainingTimestamp: '2026-04-04T00:00:00.000Z', ensembleTrained: true, trainedSampleCount: 42 },
    };
    const res = await request(app).post('/api/ml/train').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.trainedSampleCount).toBe(42);
  });
});

describe('GET /ml/model/status', () => {
  it('proxies the monolith status unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/model-status'] = {
      status: 200,
      body: { ensemble_trained: true, trained_sample_count: 10, total_swipes_available: 25, last_trained: '2026-05-05T00:00:00.000Z', ml_service_reachable: true },
    };
    const res = await request(app).get('/api/ml/model/status').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.total_swipes_available).toBe(25);
  });
});

describe('GET /ml/model/versions', () => {
  it('proxies the monolith versions list unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-scoring/model-versions'] = { status: 200, body: [] };
    const res = await request(app).get('/api/ml/model/versions').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('monolith unreachable', () => {
  it('returns 502 (not a 500 or a fabricated success) when the monolith cannot be reached', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.MONOLITH_INTERNAL_URL;
    process.env.MONOLITH_INTERNAL_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');
    const res = await request(appWithDeadMonolith).get('/api/ml/config').set('Cookie', adminCookie());
    expect(res.status).toBe(502);
    process.env.MONOLITH_INTERNAL_URL = originalUrl;
  });
});
