/**
 * Integration tests for GET /internal/jobs and GET /internal/jobs/:id - real HTTP against a real
 * database seeded directly (standing in for dual-write having already mirrored a job from the
 * monolith's own createJob).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

beforeAll(async () => {
  await pool.query(
    `INSERT INTO jobs (id, company_id, title, description, required_skills, status)
     VALUES (900401, 801, 'Senior Backend Engineer', 'Build APIs', ARRAY['Node.js','PostgreSQL'], 'open'),
            (900402, 801, 'Closed Role', 'n/a', ARRAY[]::text[], 'closed'),
            (900403, 802, 'Other Company Job', 'n/a', ARRAY[]::text[], 'open')`
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM jobs WHERE id IN (900401, 900402, 900403)');
  await pool.end();
});

describe('GET /internal/jobs', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/jobs');
    expect(res.status).toBe(400);
  });

  it('returns only open jobs scoped to the given company', async () => {
    const res = await request(app).get('/internal/jobs').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].id).toBe(900401);
    expect(res.body.jobs[0].title).toBe('Senior Backend Engineer');
  });
});

describe('GET /internal/jobs/:id', () => {
  it('requires a valid id and companyId', async () => {
    const res = await request(app).get('/internal/jobs/abc');
    expect(res.status).toBe(400);
  });

  it('returns a real seeded job scoped to its company', async () => {
    const res = await request(app).get('/internal/jobs/900401').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.job.title).toBe('Senior Backend Engineer');
    expect(res.body.job.required_skills).toEqual(['Node.js', 'PostgreSQL']);
  });

  it('returns 404 for a job scoped to a different company (tenant isolation)', async () => {
    const res = await request(app).get('/internal/jobs/900403').query({ companyId: 801 });
    expect(res.status).toBe(404);
  });
});

describe('GET /internal/jobs/by-ids (Remaining-monolith migration, Step 6)', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/jobs/by-ids').query({ ids: '900401' });
    expect(res.status).toBe(400);
  });

  it('returns jobs by id regardless of status, scoped to the company - no open-only filter', async () => {
    const res = await request(app).get('/internal/jobs/by-ids').query({ companyId: 801, ids: '900401,900402' });
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: any) => j.id).sort()).toEqual([900401, 900402]);
  });

  it('excludes ids belonging to a different company (tenant isolation)', async () => {
    const res = await request(app).get('/internal/jobs/by-ids').query({ companyId: 801, ids: '900401,900403' });
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: any) => j.id)).toEqual([900401]);
  });

  it('returns an empty list for an empty ids param, without erroring', async () => {
    const res = await request(app).get('/internal/jobs/by-ids').query({ companyId: 801, ids: '' });
    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });
});
