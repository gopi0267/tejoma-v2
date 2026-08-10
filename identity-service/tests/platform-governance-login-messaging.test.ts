/**
 * Integration test for the differentiated pending/rejected login error messaging (Batch 10) -
 * real HTTP against a real, minimal stand-in Platform Governance Service (not a mock of
 * platformGovernanceClient.ts's fetch call), mirroring the same "stand in a real lightweight HTTP
 * server for a service boundary" approach used by
 * platform-governance-service/tests/helpers/mockIdentityJwks.ts and this service's own Google
 * OAuth tests. vi.resetModules() before the dynamic import, for the same cross-file
 * process.env-caching reason documented in tests/google-oauth-configured.test.ts's header
 * comment - auth.routes.ts reads PLATFORM_GOVERNANCE_SERVICE_URL once at module load via
 * platformGovernanceClient.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';

let mockPlatformGovernance: http.Server;
let mockResponseByEmail: Record<string, { status: number; body: any }> = {};
let app: import('express').Express;

beforeAll(async () => {
  mockPlatformGovernance = http.createServer((req, res) => {
    const url = new URL(req.url || '', 'http://localhost');
    const email = url.searchParams.get('value') || '';
    const match = mockResponseByEmail[email];
    res.setHeader('Content-Type', 'application/json');
    if (!match) {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: null }));
      return;
    }
    res.statusCode = match.status;
    res.end(JSON.stringify(match.body));
  });
  await new Promise<void>((resolve) => mockPlatformGovernance.listen(0, '127.0.0.1', resolve));
  const address = mockPlatformGovernance.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind mock server');
  process.env.PLATFORM_GOVERNANCE_SERVICE_URL = `http://127.0.0.1:${address.port}`;

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  delete process.env.PLATFORM_GOVERNANCE_SERVICE_URL;
  await new Promise<void>((resolve, reject) => mockPlatformGovernance.close((err) => (err ? reject(err) : resolve())));
});

describe('POST /api/auth/login - differentiated pending/rejected registration messaging', () => {
  it('returns a pending-specific message when the identifier matches a pending registration request', async () => {
    const request = (await import('supertest')).default;
    mockResponseByEmail = { 'pending-applicant@example.test': { status: 200, body: { status: 'pending' } } };

    const res = await request(app).post('/api/auth/login').send({ identifier: 'pending-applicant@example.test', password: 'whatever9!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Your company registration is pending administrator approval.');
  });

  it('returns a rejected-specific message when the identifier matches a rejected registration request', async () => {
    const request = (await import('supertest')).default;
    mockResponseByEmail = { 'rejected-applicant@example.test': { status: 200, body: { status: 'rejected' } } };

    const res = await request(app).post('/api/auth/login').send({ identifier: 'rejected-applicant@example.test', password: 'whatever9!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Your company registration has been rejected.');
  });

  it('falls back to the generic message when no registration request matches (real 404 from Platform Governance Service)', async () => {
    const request = (await import('supertest')).default;
    mockResponseByEmail = {};

    const res = await request(app).post('/api/auth/login').send({ identifier: 'nobody-at-all@example.test', password: 'whatever9!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});
