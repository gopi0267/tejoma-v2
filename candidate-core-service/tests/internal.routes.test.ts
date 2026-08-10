/**
 * Integration tests for GET /internal/candidates, GET /internal/candidates/:id,
 * GET /internal/candidates/for-job-scoring, GET /internal/candidates/by-ids, and
 * GET /internal/candidates/count - real HTTP against a real database seeded directly
 * (standing in for dual-write having already mirrored candidates from the monolith's own
 * createCandidate). The count endpoint is used by job-service's GET /api/jobs list enrichment
 * (remaining-monolith migration, Item 1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Load env vars from candidate-core-service's .env.local before importing modules
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env.local');
const envContent = readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach((line) => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=');
    if (key && value) {
      process.env[key.trim()] = value.trim().replace(/^"(.*)"$/, '$1');
    }
  }
});

let app: import('express').Express;
let pool: import('pg').Pool;

beforeAll(async () => {
  const imported = await Promise.all([
    import('../src/server.js'),
    import('../src/db.js'),
  ]);
  app = imported[0].app;
  pool = imported[1].pool;

  // Clean up any existing data for test candidates
  await pool.query('DELETE FROM candidates WHERE id IN (900501, 900502)');
  await pool.query(
    `INSERT INTO candidates (id, company_id, name, email, skills)
     VALUES (900501, 801, 'Jane Doe', 'jane@example.test', 'TypeScript, React'),
            (900502, 802, 'Other Company Candidate', 'other@example.test', 'Python')`
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM candidates WHERE id IN (900501, 900502)');
  await pool.end();
});

describe('GET /internal/candidates', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/candidates');
    expect(res.status).toBe(400);
  });

  it('returns candidates scoped to the given company', async () => {
    const res = await request(app).get('/internal/candidates').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(900501);
    expect(res.body.candidates[0].name).toBe('Jane Doe');
  });
});

describe('GET /internal/candidates/:id', () => {
  it('requires a valid id and companyId', async () => {
    const res = await request(app).get('/internal/candidates/abc');
    expect(res.status).toBe(400);
  });

  it('returns a real seeded candidate scoped to its company', async () => {
    const res = await request(app).get('/internal/candidates/900501').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.candidate.name).toBe('Jane Doe');
    expect(res.body.candidate.skills).toBe('TypeScript, React');
  });

  it('returns 404 for a candidate scoped to a different company (tenant isolation)', async () => {
    const res = await request(app).get('/internal/candidates/900502').query({ companyId: 801 });
    expect(res.status).toBe(404);
  });
});

describe('GET /internal/candidates/for-job-scoring (remaining-monolith migration, Step 4)', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/candidates/for-job-scoring');
    expect(res.status).toBe(400);
  });

  it('returns candidates scoped to the company, parsed into real arrays (feeds directly into the scoring engine)', async () => {
    const res = await request(app).get('/internal/candidates/for-job-scoring').query({ companyId: 801, requiredSkills: 'TypeScript,React' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(900501);
    expect(res.body.candidates[0].skills).toEqual(['TypeScript', 'React']);
  });

  it('does not leak candidates scoped to a different company', async () => {
    const res = await request(app).get('/internal/candidates/for-job-scoring').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.candidates.every((c: any) => c.id !== 900502)).toBe(true);
  });
});

describe('GET /internal/candidates/by-ids (Remaining-monolith migration, Step 6)', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/candidates/by-ids').query({ ids: '900501' });
    expect(res.status).toBe(400);
  });

  it('returns candidates by id scoped to the company, parsed into real arrays', async () => {
    const res = await request(app).get('/internal/candidates/by-ids').query({ companyId: 801, ids: '900501' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(900501);
    expect(res.body.candidates[0].skills).toEqual(['TypeScript', 'React']);
  });

  it('excludes ids belonging to a different company (tenant isolation)', async () => {
    const res = await request(app).get('/internal/candidates/by-ids').query({ companyId: 801, ids: '900501,900502' });
    expect(res.status).toBe(200);
    expect(res.body.candidates.map((c: any) => c.id)).toEqual([900501]);
  });

  it('returns an empty list for an empty ids param, without erroring', async () => {
    const res = await request(app).get('/internal/candidates/by-ids').query({ companyId: 801, ids: '' });
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });
});

describe('GET /internal/candidates/count (remaining-monolith migration, Item 1)', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/candidates/count');
    expect(res.status).toBe(400);
  });

  it('returns the total candidate count for the given company', async () => {
    const res = await request(app).get('/internal/candidates/count').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('counts only candidates belonging to the given company (tenant isolation)', async () => {
    const res = await request(app).get('/internal/candidates/count').query({ companyId: 802 });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('returns 0 for a company with no candidates', async () => {
    const res = await request(app).get('/internal/candidates/count').query({ companyId: 999 });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});
