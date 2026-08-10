/**
 * Integration tests for the internal by-identifier lookup - the endpoint identity-service's login
 * flow calls to render differentiated pending/rejected messaging (see this service's
 * src/routes/internal.routes.ts header comment).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || 'http://127.0.0.1:1';

let app: import('express').Express;
let pool: import('pg').Pool;

const ADMIN_EMAIL = 'batch10-internal-lookup@example.test';

beforeAll(async () => {
  ({ app } = await import('../src/server.js'));
  ({ pool } = await import('../src/db.js'));

  await pool.query('DELETE FROM company_registration_requests WHERE lower(admin_email) = lower($1)', [ADMIN_EMAIL]);
  await pool.query(
    `INSERT INTO company_registration_requests (company_name, business_email, admin_name, admin_email, password_hash, status)
     VALUES ($1, $2, $3, $4, 'x', 'pending')`,
    ['Batch10 Internal Lookup Co', 'business@batch10-internal.example.test', 'Internal Lookup Admin', ADMIN_EMAIL]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM company_registration_requests WHERE lower(admin_email) = lower($1)', [ADMIN_EMAIL]);
  await pool.end();
});

describe('GET /internal/company-requests/by-identifier', () => {
  it('returns the request status for a known admin email', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/company-requests/by-identifier').query({ type: 'email', value: ADMIN_EMAIL });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('returns 404 with a null status for an unknown identifier', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/company-requests/by-identifier').query({ type: 'email', value: 'nobody-batch10@example.test' });
    expect(res.status).toBe(404);
    expect(res.body.status).toBeNull();
  });

  it('never leaks the password hash or other applicant PII - only status', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/company-requests/by-identifier').query({ type: 'email', value: ADMIN_EMAIL });
    expect(Object.keys(res.body)).toEqual(['status']);
  });

  it('rejects an invalid type parameter', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/company-requests/by-identifier').query({ type: 'fax', value: 'x' });
    expect(res.status).toBe(422);
  });
});
