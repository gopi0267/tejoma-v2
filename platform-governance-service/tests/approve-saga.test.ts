/**
 * Integration tests for the approve saga (Batch 11) - real HTTP, real database, real Postgres
 * advisory locks, real cross-service HTTP calls against real (lightweight, purpose-built) stand-in
 * servers for Tenant Directory Service and Identity Service (see tests/helpers/mockTenantDirectory.ts
 * and the extended tests/helpers/mockIdentityJwks.ts) - nothing here mocks a function or module,
 * only stands in for a service boundary with a real HTTP server, matching this whole series'
 * "never mock" discipline.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { startMockIdentityService, type MockIdentityService } from './helpers/mockIdentityJwks.js';
import { startMockTenantDirectory, type MockTenantDirectory } from './helpers/mockTenantDirectory.js';
import type { AccessTokenPayload } from '../src/types.js';

let mockIdentity: MockIdentityService;
let mockTenantDirectory: MockTenantDirectory;
let app: import('express').Express;
let pool: import('pg').Pool;

const SUPERADMIN: AccessTokenPayload = { user_id: 1, email: 'super@example.test', name: 'Super Admin', company_id: 1, role: 'superadmin' };
const RECRUITER: AccessTokenPayload = { user_id: 2, email: 'recruiter@example.test', name: 'Recruiter', company_id: 1, role: 'recruiter' };

beforeAll(async () => {
  mockIdentity = await startMockIdentityService();
  mockTenantDirectory = await startMockTenantDirectory();
  process.env.IDENTITY_SERVICE_URL = mockIdentity.url;
  process.env.TENANT_DIRECTORY_SERVICE_URL = mockTenantDirectory.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
  ({ pool } = await import('../src/db.js'));
});

afterAll(async () => {
  await pool.query("DELETE FROM company_registration_requests WHERE lower(company_name) LIKE 'batch11 saga%'");
  await pool.end();
  await mockIdentity.close();
  await mockTenantDirectory.close();
});

beforeEach(() => {
  mockTenantDirectory.scenario.createCompany = 'succeed';
  mockTenantDirectory.scenario.deactivateCompany = 'succeed';
  mockIdentity.scenario.createUser = 'succeed';
});

async function seedPendingRequest(companyName: string): Promise<number> {
  const passwordHash = await bcrypt.hash('SagaTestPass9!', 10);
  const result = await pool.query(
    `INSERT INTO company_registration_requests (company_name, business_email, admin_name, admin_email, password_hash, status)
     VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
    [companyName, `biz@${companyName.toLowerCase().replace(/\s+/g, '-')}.example.test`, 'Saga Test Admin', `admin@${companyName.toLowerCase().replace(/\s+/g, '-')}.example.test`, passwordHash]
  );
  return result.rows[0].id;
}

function authedPatch(request: any, url: string, payload: AccessTokenPayload = SUPERADMIN) {
  const token = mockIdentity.signStaffToken(payload);
  return request(app).patch(url).set('Cookie', `access_token=${token}`);
}

describe('PATCH /api/admin/company-requests/:id/approve', () => {
  it('rejects a non-superadmin', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Auth Co');
    const res = await authedPatch(request, `/api/admin/company-requests/${id}/approve`, RECRUITER);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent request', async () => {
    const request = (await import('supertest')).default;
    const res = await authedPatch(request, '/api/admin/company-requests/999999999/approve');
    expect(res.status).toBe(404);
  });

  it('approves a pending request end-to-end: creates the company, creates the admin user, finalizes the request', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Success Co');

    const res = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('approved');
    expect(res.body.request.reviewed_by).toBe(SUPERADMIN.user_id);
    expect(res.body.company.name).toBe('Batch11 Saga Success Co');
    expect(res.body.adminUser.role).toBe('admin');
    expect(res.body.adminUser).not.toHaveProperty('password_hash');

    const row = await pool.query('SELECT * FROM company_registration_requests WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('approved');
    expect(row.rows[0].resulting_company_id).toBeTruthy();
    expect(row.rows[0].resulting_user_id).toBeTruthy();

    expect(mockTenantDirectory.createdCompanies.some((c) => c.name === 'Batch11 Saga Success Co')).toBe(true);
    expect(mockIdentity.createdUsers.some((u) => u.email === row.rows[0].admin_email)).toBe(true);
  });

  it('rejects approving an already-approved request', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Double Approve Co');
    await authedPatch(request, `/api/admin/company-requests/${id}/approve`);

    const second = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(second.status).toBe(400);
    expect(second.body.error).toContain('already been approved');
  });

  it('when company creation fails, leaves the request pending with no checkpointed company, and no user is created', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Company Fail Co');
    mockTenantDirectory.scenario.createCompany = 'fail';

    const res = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(res.status).toBe(502);

    const row = await pool.query('SELECT status, resulting_company_id FROM company_registration_requests WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].resulting_company_id).toBeNull();
    expect(mockIdentity.createdUsers.some((u) => u.email?.includes('batch11-saga-company-fail-co'))).toBe(false);
  });

  it('when user creation fails after company succeeded, compensates by deactivating the company and clears the checkpoint, leaving the request pending', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga User Fail Co');
    mockIdentity.scenario.createUser = 'fail';

    const res = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(res.status).toBe(502);

    const row = await pool.query('SELECT status, resulting_company_id FROM company_registration_requests WHERE id = $1', [id]);
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].resulting_company_id).toBeNull();

    const createdCompany = mockTenantDirectory.createdCompanies.find((c) => c.name === 'Batch11 Saga User Fail Co');
    expect(createdCompany).toBeTruthy();
    expect(mockTenantDirectory.deactivatedCompanyIds).toContain(createdCompany.id);
  });

  it('a retry after a compensated user-creation failure succeeds and creates a fresh company (not the deactivated one)', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Retry Co');
    mockIdentity.scenario.createUser = 'fail';

    const firstAttempt = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(firstAttempt.status).toBe(502);
    const firstCompany = mockTenantDirectory.createdCompanies.find((c) => c.name === 'Batch11 Saga Retry Co');

    mockIdentity.scenario.createUser = 'succeed';
    const secondAttempt = await authedPatch(request, `/api/admin/company-requests/${id}/approve`);
    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.request.status).toBe('approved');

    const companiesNamedRetryCo = mockTenantDirectory.createdCompanies.filter((c) => c.name === 'Batch11 Saga Retry Co');
    expect(companiesNamedRetryCo).toHaveLength(2);
    expect(secondAttempt.body.company.id).not.toBe(firstCompany.id);
  });

  it('rejects a second, truly concurrent approve attempt for the same request while the first is in flight', async () => {
    const request = (await import('supertest')).default;
    const id = await seedPendingRequest('Batch11 Saga Concurrent Co');

    const [first, second] = await Promise.all([
      authedPatch(request, `/api/admin/company-requests/${id}/approve`),
      authedPatch(request, `/api/admin/company-requests/${id}/approve`),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one succeeds (200); the other is told to retry (409) because the advisory lock was
    // already held - never both succeeding, never both failing.
    expect(statuses).toEqual([200, 409]);
  });
});
