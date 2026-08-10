/**
 * Integration tests for the JWKS-based staff auth middleware - the first Tier 0 service other
 * than Identity Service itself to verify a staff access token (see
 * src/middleware/staffAuth.middleware.ts's header comment). Real HTTP throughout: a real mock
 * Identity Service (tests/helpers/mockIdentityJwks.ts) serves a real JWKS document over a real
 * HTTP server; this service's app makes a real jwks-rsa fetch against it and a real
 * jsonwebtoken RS256 verification - nothing here is mocked.
 *
 * Exercised against GET /api/admin/company-requests, a real superadmin-gated route, rather than
 * testing the middleware in isolation - proves the whole chain (extract token -> fetch JWKS ->
 * verify signature -> check role -> reach the handler) works end-to-end.
 *
 * NOT tested: the `if (!client)` defensive branch in staffAuth.middleware.ts for
 * IDENTITY_SERVICE_URL being unset - config/env.ts's fail-fast startup check makes that state
 * unreachable via normal app startup (the process would exit(1) before the app ever exists to
 * test), so there is no HTTP-level way to reach it. It remains a deliberate defensive safety net,
 * not untested business logic.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockIdentityService, signWithWrongKey, type MockIdentityService } from './helpers/mockIdentityJwks.js';
import type { AccessTokenPayload } from '../src/types.js';

let mockIdentity: MockIdentityService;
let app: import('express').Express;

const SUPERADMIN_PAYLOAD: AccessTokenPayload = { user_id: 1, email: 'super@example.test', name: 'Super Admin', company_id: 1, role: 'superadmin' };
const RECRUITER_PAYLOAD: AccessTokenPayload = { user_id: 2, email: 'recruiter@example.test', name: 'Recruiter', company_id: 1, role: 'recruiter' };

beforeAll(async () => {
  mockIdentity = await startMockIdentityService();
  process.env.IDENTITY_SERVICE_URL = mockIdentity.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await mockIdentity.close();
});

describe('GET /api/admin/company-requests (staff auth via JWKS)', () => {
  it('rejects with no token at all', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/admin/company-requests');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/admin/company-requests').set('Cookie', 'access_token=not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed by a different (impostor) key', async () => {
    const request = (await import('supertest')).default;
    const impostorToken = signWithWrongKey(SUPERADMIN_PAYLOAD);
    const res = await request(app).get('/api/admin/company-requests').set('Cookie', `access_token=${impostorToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a valid, correctly-signed token from a non-superadmin role', async () => {
    const request = (await import('supertest')).default;
    const token = mockIdentity.signStaffToken(RECRUITER_PAYLOAD);
    const res = await request(app).get('/api/admin/company-requests').set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(403);
  });

  it('accepts a valid, correctly-signed superadmin token via cookie, verified against the real JWKS document', async () => {
    const request = (await import('supertest')).default;
    const token = mockIdentity.signStaffToken(SUPERADMIN_PAYLOAD);
    const res = await request(app).get('/api/admin/company-requests').set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('stats');
  });

  it('accepts a valid superadmin token via the Authorization header fallback too', async () => {
    const request = (await import('supertest')).default;
    const token = mockIdentity.signStaffToken(SUPERADMIN_PAYLOAD);
    const res = await request(app).get('/api/admin/company-requests').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects an expired token', async () => {
    const request = (await import('supertest')).default;
    const expiredToken = mockIdentity.signStaffToken(SUPERADMIN_PAYLOAD, { expiresInSeconds: -1 });
    const res = await request(app).get('/api/admin/company-requests').set('Cookie', `access_token=${expiredToken}`);
    expect(res.status).toBe(401);
  });
});
