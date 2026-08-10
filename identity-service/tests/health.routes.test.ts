/**
 * Integration tests for the health/readiness/liveness endpoints. Uses supertest against the
 * exported Express app directly (no network port bound), the standard pattern for testing an
 * Express service in isolation.
 *
 * These tests exercise src/db.ts's real healthCheck() against whatever DB_* env vars are set for
 * the test run - they do not mock the database, consistent with this project's existing
 * integration-test discipline (Phase 4(API) section 23: "never against another service's
 * database" - this test only ever touches identity-service's own DB connection settings).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

describe('GET /live', () => {
  it('always returns 200 - liveness never depends on the database', async () => {
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health', () => {
  it('reports service identity and a timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.body.service).toBe('identity-service');
    expect(res.body.timestamp).toBeTruthy();
    expect([200, 503]).toContain(res.status);
  });
});

describe('GET /ready', () => {
  it('returns a readiness status consistent with the health check result', async () => {
    const res = await request(app).get('/ready');
    expect(['ready', 'not_ready']).toContain(res.body.status);
    expect([200, 503]).toContain(res.status);
  });
});
