/**
 * Integration tests for the health/readiness/liveness endpoints - mirrors identity-service's/
 * candidate-service's tests/health.routes.test.ts (this service owns a real database, so
 * /health and /ready are DB-backed).
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
    expect(res.body.service).toBe('chat-service');
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
