/**
 * Integration tests for the company registration/approval workflow - real HTTP, real database
 * (whatever DB_* env vars the test run supplies), real bcrypt/zod/zxcvbn validation throughout.
 * Uses the same real mock-Identity-Service JWKS helper as staffAuth.middleware.test.ts for the
 * superadmin-gated routes (list/detail/reject).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockIdentityService, type MockIdentityService } from './helpers/mockIdentityJwks.js';
import type { AccessTokenPayload } from '../src/types.js';

let mockIdentity: MockIdentityService;
let app: import('express').Express;
let pool: import('pg').Pool;

const SUPERADMIN: AccessTokenPayload = { user_id: 1, email: 'super@example.test', name: 'Super Admin', company_id: 1, role: 'superadmin' };

const BASE_REGISTRATION = {
  companyName: 'Batch10 Test Co',
  businessEmail: 'business@batch10-testco.example.test',
  adminName: 'Batch10 Admin',
  adminEmail: 'admin@batch10-testco.example.test',
  password: 'ValidCompanyPass9!',
};

beforeAll(async () => {
  mockIdentity = await startMockIdentityService();
  process.env.IDENTITY_SERVICE_URL = mockIdentity.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
  ({ pool } = await import('../src/db.js'));

  await pool.query(
    `DELETE FROM company_registration_requests WHERE lower(company_name) = lower($1) OR lower(business_email) = lower($2) OR lower(admin_email) = lower($3)`,
    [BASE_REGISTRATION.companyName, BASE_REGISTRATION.businessEmail, BASE_REGISTRATION.adminEmail]
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM company_registration_requests WHERE lower(company_name) = lower($1) OR lower(business_email) = lower($2) OR lower(admin_email) = lower($3)`,
    [BASE_REGISTRATION.companyName, BASE_REGISTRATION.businessEmail, BASE_REGISTRATION.adminEmail]
  );
  await pool.end();
  await mockIdentity.close();
});

function authedRequest(request: any) {
  const token = mockIdentity.signStaffToken(SUPERADMIN);
  return { get: (url: string) => request(app).get(url).set('Cookie', `access_token=${token}`), patch: (url: string) => request(app).patch(url).set('Cookie', `access_token=${token}`) };
}

describe('POST /api/company-registration', () => {
  it('rejects invalid input (422)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/company-registration').send({ companyName: '' });
    expect(res.status).toBe(422);
  });

  it('rejects a weak password', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/company-registration').send({ ...BASE_REGISTRATION, password: 'weak' });
    expect(res.status).toBe(400);
    expect(res.body.password_strength).toBeTruthy();
  });

  it('submits a valid registration request and never returns the password hash', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/company-registration').send(BASE_REGISTRATION);
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('pending');
    expect(res.body.request.company_name).toBe(BASE_REGISTRATION.companyName);
    expect(res.body.request).not.toHaveProperty('password_hash');
  });

  it('rejects a duplicate pending request for the same company name', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/company-registration').send({
      ...BASE_REGISTRATION,
      businessEmail: 'different-business@batch10-testco.example.test',
      adminEmail: 'different-admin@batch10-testco.example.test',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('company name');
  });
});

describe('GET /api/admin/company-requests (superadmin only)', () => {
  it('rejects without auth', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/admin/company-requests');
    expect(res.status).toBe(401);
  });

  it('lists the submitted request with correct stats, for a superadmin', async () => {
    const request = (await import('supertest')).default;
    const res = await authedRequest(request).get('/api/admin/company-requests?pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.stats.pending).toBeGreaterThanOrEqual(1);
    const found = res.body.data.find((r: any) => r.company_name === BASE_REGISTRATION.companyName);
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty('password_hash');
  });

  it('filters by status', async () => {
    const request = (await import('supertest')).default;
    const res = await authedRequest(request).get('/api/admin/company-requests?status=rejected&pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: any) => r.status === 'rejected')).toBe(true);
  });
});

describe('GET /api/admin/company-requests/:id + PATCH .../reject', () => {
  it('returns 404 for a nonexistent id', async () => {
    const request = (await import('supertest')).default;
    const res = await authedRequest(request).get('/api/admin/company-requests/999999999');
    expect(res.status).toBe(404);
  });

  it('rejects a reject-request with no reason', async () => {
    const request = (await import('supertest')).default;
    const listRes = await authedRequest(request).get(`/api/admin/company-requests?companyName=${encodeURIComponent(BASE_REGISTRATION.companyName)}`);
    const id = listRes.body.data[0].id;

    const res = await authedRequest(request).patch(`/api/admin/company-requests/${id}/reject`).send({});
    expect(res.status).toBe(422);
  });

  it('rejects the request end-to-end, then refuses to reject it again (idempotency)', async () => {
    const request = (await import('supertest')).default;
    const listRes = await authedRequest(request).get(`/api/admin/company-requests?companyName=${encodeURIComponent(BASE_REGISTRATION.companyName)}`);
    const id = listRes.body.data[0].id;

    const res = await authedRequest(request).patch(`/api/admin/company-requests/${id}/reject`).send({ reason: 'Not a good fit for this batch of tests' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.reviewed_by).toBe(SUPERADMIN.user_id);

    const second = await authedRequest(request).patch(`/api/admin/company-requests/${id}/reject`).send({ reason: 'Trying again' });
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('already been rejected');
  });

  it('a resubmission after rejection is allowed (partial unique index only applies to pending rows)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/company-registration').send(BASE_REGISTRATION);
    expect(res.status).toBe(201);
  });
});
