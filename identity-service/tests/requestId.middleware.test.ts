/**
 * Tests the request-id tracing seam (Batch 9) - a genuinely new capability, not a port. Verifies
 * both halves of the contract: a fresh UUID is generated and echoed back when the caller doesn't
 * supply one, and a caller-supplied X-Request-Id is forwarded unchanged (the behavior a future
 * Gateway or upstream service depends on for real cross-service correlation).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('X-Request-Id tracing seam', () => {
  it('generates and returns a fresh UUID when the caller sends none', async () => {
    const res = await request(app).get('/live');
    expect(res.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('forwards a caller-supplied X-Request-Id unchanged, for future cross-service correlation', async () => {
    const res = await request(app).get('/live').set('X-Request-Id', 'test-fixed-correlation-id-123');
    expect(res.headers['x-request-id']).toBe('test-fixed-correlation-id-123');
  });

  it('generates distinct IDs across separate requests', async () => {
    const first = await request(app).get('/live');
    const second = await request(app).get('/live');
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });
});
