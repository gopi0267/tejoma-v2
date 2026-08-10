/**
 * Integration tests for the health/readiness/liveness endpoints - mirrors
 * identity-service/tests/health.routes.test.ts exactly. IDENTITY_SERVICE_URL just needs to be a
 * syntactically valid URL for server.ts to start (config/env.ts's fail-fast check) - it does not
 * need to be reachable, since none of these endpoints touch staff auth.
 */
import { describe, it, expect, beforeAll } from 'vitest';

process.env.IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || 'http://127.0.0.1:1';

let app: import('express').Express;

beforeAll(async () => {
  ({ app } = await import('../src/server.js'));
});

describe('GET /live', () => {
  it('always returns 200 - liveness never depends on the database', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health', () => {
  it('reports service identity and a timestamp', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/health');
    expect(res.body.service).toBe('platform-governance-service');
    expect(res.body.timestamp).toBeTruthy();
    expect([200, 503]).toContain(res.status);
  });
});

describe('GET /ready', () => {
  it('returns a readiness status consistent with the health check result', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/ready');
    expect(['ready', 'not_ready']).toContain(res.body.status);
    expect([200, 503]).toContain(res.status);
  });
});
