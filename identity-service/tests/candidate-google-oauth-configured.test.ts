/**
 * Tests the candidate Google OAuth branches reachable ONLY when configured, without ever calling
 * Google for real (same non-network-call reasoning as tests/google-oauth-configured.test.ts).
 * Uses vi.resetModules() before the dynamic import for the same cross-file module-cache-leak
 * reason documented in that file's header comment.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4001/api/candidate-auth/google/callback';

let app: import('express').Express;

beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe('GET /api/candidate-auth/google (configured)', () => {
  it('redirects to a real Google authorization URL with the correct query parameters', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-auth/google');
    expect(res.status).toBe(302);

    const location = new URL(res.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('fake-client-id.apps.googleusercontent.com');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:4001/api/candidate-auth/google/callback');
    expect(location.searchParams.get('scope')).toContain('email');
    expect(location.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('GET /api/candidate-auth/google/callback (configured, no code)', () => {
  it('redirects to a generic auth-failed error without attempting to call Google', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-auth/google/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/candidate?auth_error=google_auth_failed');
  });
});
