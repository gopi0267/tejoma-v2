/**
 * Integration tests for the internal companies API - real HTTP, real database (whatever DB_* env
 * vars the test run supplies), real slug/id generation throughout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, closePool } from '../src/db.js';

const TEST_NAME = 'Batch11 Test Directory Co';
const createdIds: number[] = [];

beforeAll(async () => {
  await pool.query('DELETE FROM companies WHERE lower(name) = lower($1)', [TEST_NAME]);
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM companies WHERE id = ANY($1)', [createdIds]);
  }
  await pool.query('DELETE FROM companies WHERE lower(name) = lower($1)', [TEST_NAME]);
  await closePool();
});

describe('GET /internal/companies/exists', () => {
  it('returns false for an unknown name', async () => {
    const res = await request(app).get('/internal/companies/exists').query({ name: 'Nobody Batch11 Inc' });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  it('rejects a missing name parameter', async () => {
    const res = await request(app).get('/internal/companies/exists');
    expect(res.status).toBe(422);
  });
});

describe('POST /internal/companies', () => {
  it('rejects invalid input', async () => {
    const res = await request(app).post('/internal/companies').send({ name: '' });
    expect(res.status).toBe(422);
  });

  it('creates a company with a reserved id and a matching slug', async () => {
    const res = await request(app).post('/internal/companies').send({ name: TEST_NAME, industry: 'Testing', website: 'https://batch11.example.test' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(TEST_NAME);
    expect(res.body.industry).toBe('Testing');
    expect(res.body.plan).toBe('starter');
    expect(res.body.seats_limit).toBe(5);
    expect(res.body.is_active).toBe(true);
    expect(res.body.company_slug).toBe(`batch11-test-directory-co-${res.body.id}`);
    createdIds.push(res.body.id);
  });

  it('defaults industry to Technology when not supplied', async () => {
    const res = await request(app).post('/internal/companies').send({ name: 'Batch11 No Industry Co' });
    expect(res.status).toBe(201);
    expect(res.body.industry).toBe('Technology');
    createdIds.push(res.body.id);
    await pool.query('DELETE FROM companies WHERE id = $1', [res.body.id]);
  });

  it('rejects a duplicate company name with 409', async () => {
    const res = await request(app).post('/internal/companies').send({ name: TEST_NAME });
    expect(res.status).toBe(409);
  });

  it('now confirms the company exists via the exists endpoint', async () => {
    const res = await request(app).get('/internal/companies/exists').query({ name: TEST_NAME });
    expect(res.body.exists).toBe(true);
  });
});

describe('GET /internal/companies/:id', () => {
  it('returns 404 for a nonexistent id', async () => {
    const res = await request(app).get('/internal/companies/999999999');
    expect(res.status).toBe(404);
  });

  it('returns the full company row for a real company (two different callers read two different slices of it - see route header comment)', async () => {
    const res = await request(app).get(`/internal/companies/${createdIds[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(TEST_NAME);
    expect(res.body.company_slug).toBeTruthy();
    expect(res.body.seats_limit).toBe(5);
  });
});

describe('PATCH /internal/companies/:id/deactivate', () => {
  it('returns 404 for a nonexistent id', async () => {
    const res = await request(app).patch('/internal/companies/999999999/deactivate');
    expect(res.status).toBe(404);
  });

  it('deactivates a real company', async () => {
    const res = await request(app).patch(`/internal/companies/${createdIds[0]}/deactivate`);
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT is_active FROM companies WHERE id = $1', [createdIds[0]]);
    expect(row.rows[0].is_active).toBe(false);
  });
});
