/**
 * Integration tests for the health/readiness/liveness endpoints - mirrors every other Tier 0
 * service's tests/health.routes.test.ts, minus the DB-down case (this service has no database).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

describe('GET /live', () => {
  it('always returns 200', async () => {
    const res = await request(app).get('/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health', () => {
  it('reports service identity and a timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('jd-parser-service');
    expect(res.body.timestamp).toBeTruthy();
  });
});

describe('GET /ready', () => {
  it('reports ready - no external dependency required to be ready', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});
