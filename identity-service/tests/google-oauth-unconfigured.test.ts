/**
 * Tests the Google OAuth "not configured" branches - the actual real state of this dev
 * environment (no GOOGLE_CLIENT_ID/SECRET/STAFF_GOOGLE_REDIRECT_URI set), so these assertions
 * exercise real, currently-true behavior, not a hypothetical.
 *
 * IMPORTANT, a real cross-file test-isolation bug found and fixed in this batch: auth.routes.ts
 * reads GOOGLE_CLIENT_ID/SECRET/STAFF_GOOGLE_REDIRECT_URI ONCE at module load and computes
 * staffGoogleClient from them at that moment. Vitest can share a module registry across test
 * files within one worker process, so if google-oauth-configured.test.ts's module import
 * happened first in that worker, its non-null staffGoogleClient would be the SAME cached module
 * instance this file's import would receive too - a plain env-var afterAll cleanup in the other
 * file does not undo an already-cached module evaluation. The fix: vi.resetModules() here forces
 * a genuinely fresh evaluation of server.js (and everything it imports) with THIS file's own
 * env state, regardless of what any other file already did in the same worker - making this
 * file's result independent of test execution order, which it must be.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.STAFF_GOOGLE_REDIRECT_URI;

let app: import('express').Express;

beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

describe('GET /api/auth/google (not configured)', () => {
  it('redirects with a clear error instead of crashing', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?auth_error=google_not_configured');
  });
});

describe('GET /api/auth/google/callback (not configured)', () => {
  it('redirects with a clear error instead of crashing', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?auth_error=google_not_configured');
  });
});
