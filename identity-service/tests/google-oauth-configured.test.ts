/**
 * Tests the Google OAuth branches reachable ONLY when configured, without ever calling Google for
 * real - constructing an OAuth2Client and generating an authorization URL are both pure, local
 * operations (no network call); only getToken()/verifyIdToken() inside the callback's success
 * path actually reach Google, and that path is deliberately not exercised here (see this batch's
 * routes/auth.routes.ts header comment for why, and the pre-cutover manual-verification
 * requirement this leaves).
 *
 * IMPORTANT, a real cross-file test-isolation bug found and fixed in this batch: auth.routes.ts
 * reads GOOGLE_CLIENT_ID/SECRET/STAFF_GOOGLE_REDIRECT_URI ONCE at module load. An earlier version
 * of this file set process.env before importing and cleaned up with afterAll - that was
 * insufficient, because Vitest can share one module registry across files within a worker
 * process, so whichever file's import ran first in that worker "won" and both files ended up
 * observing the SAME cached staffGoogleClient regardless of afterAll timing (cleanup happens too
 * late to un-cache an already-evaluated module). vi.resetModules() here forces a genuinely fresh
 * evaluation of server.js with THIS file's own env state, making the result independent of
 * whatever any other file already did in the same worker - and independent of execution order,
 * which a correct test must be.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
process.env.STAFF_GOOGLE_REDIRECT_URI = 'http://localhost:4001/api/auth/google/callback';

let app: import('express').Express;

beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.STAFF_GOOGLE_REDIRECT_URI;
});

describe('GET /api/auth/google (configured)', () => {
  it('redirects to a real Google authorization URL with the correct query parameters', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);

    const location = new URL(res.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('fake-client-id.apps.googleusercontent.com');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:4001/api/auth/google/callback');
    expect(location.searchParams.get('scope')).toContain('email');
    expect(location.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('GET /api/auth/google/callback (configured, no code)', () => {
  it('redirects to a generic auth-failed error without attempting to call Google', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?auth_error=google_auth_failed');
  });
});
