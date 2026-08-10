/**
 * Integration tests for the health/readiness/liveness endpoints - mirrors jd-parser-service's
 * tests/health.routes.test.ts (this service owns no database, so /health and /ready have no
 * local dependency to check).
 */
import { describe, it, expect, beforeAll } from 'vitest';

let app: import('express').Express;

beforeAll(async () => {
  process.env.MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || 'http://127.0.0.1:1';
  ({ app } = await import('../src/server.js'));
});

describe('GET /live', () => {
  it('always returns 200', async () => {
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
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('analytics-service');
    expect(res.body.timestamp).toBeTruthy();
  });
});

describe('GET /ready', () => {
  it('always returns ready - no local dependency', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
});
