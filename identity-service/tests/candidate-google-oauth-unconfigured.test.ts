/**
 * Tests the candidate Google OAuth "not configured" branches - mirrors
 * tests/google-oauth-unconfigured.test.ts's vi.resetModules() discipline exactly (see that file's
 * header comment for the full explanation of the cross-file process.env/module-cache bug this
 * guards against). candidate-auth.routes.ts reads GOOGLE_CLIENT_ID/SECRET/GOOGLE_REDIRECT_URI
 * (unprefixed - distinct from staff's STAFF_GOOGLE_REDIRECT_URI) once at module load.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.GOOGLE_REDIRECT_URI;

let app: import('express').Express;

beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

describe('GET /api/candidate-auth/google (not configured)', () => {
  it('redirects with a clear error instead of crashing', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/candidate?auth_error=google_not_configured');
  });
});

describe('GET /api/candidate-auth/google/callback (not configured)', () => {
  it('redirects with a clear error instead of crashing', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/candidate?auth_error=google_not_configured');
  });
});
