/**
 * Integration tests for GET /internal/swipes, /internal/recruiter-notes,
 * /internal/detailed-scoring-reports, and /internal/swipes/counts-by-job - real HTTP against
 * a real database seeded directly (standing in for dual-write having already mirrored rows
 * from the monolith). The counts-by-job endpoint is used by job-service's GET /api/jobs
 * list enrichment (remaining-monolith migration, Item 1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Load env vars from matching-decision-service's .env.local before importing modules
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

  // Clean up any existing data for company 801
  await pool.query('DELETE FROM swipes WHERE company_id = 801');
  await pool.query('DELETE FROM recruiter_notes WHERE company_id = 801');
  await pool.query('DELETE FROM detailed_scoring_reports WHERE company_id = 801');

  await pool.query(
    `INSERT INTO swipes (id, recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id)
     VALUES (900601, 1, 100, 200, 1, 85, NOW(), 801)`
  );
  await pool.query(
    `INSERT INTO recruiter_notes (company_id, candidate_id, job_id, note, created_by, updated_by)
     VALUES (801, 100, 200, 'Strong candidate', 1, 1)`
  );
  await pool.query(
    `INSERT INTO detailed_scoring_reports (company_id, candidate_id, job_id, report, generated_by)
     VALUES (801, 100, 200, '{"score": 90}'::jsonb, 1)`
  );
  // Seed multiple swipes with different actions for counts-by-job testing
  // action values: 0 = rejected, 0.5 = saved, 1 = accepted
  await pool.query(
    `INSERT INTO swipes (recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id)
     VALUES
       (1, 101, 300, 0, 75, NOW(), 801),
       (1, 102, 300, 0, 80, NOW(), 801),
       (1, 103, 300, 1, 90, NOW(), 801),
       (1, 104, 300, 0, 70, NOW(), 801),
       (1, 105, 300, 0.5::FLOAT, 85, NOW(), 801)`
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE id = 900601');
  await pool.query('DELETE FROM recruiter_notes WHERE company_id = 801 AND candidate_id = 100 AND job_id = 200');
  await pool.query('DELETE FROM detailed_scoring_reports WHERE company_id = 801 AND candidate_id = 100 AND job_id = 200');
  await pool.query('DELETE FROM swipes WHERE company_id = 801 AND job_id = 300');
  await pool.end();
});

describe('GET /internal/swipes', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/swipes');
    expect(res.status).toBe(400);
  });

  it('returns swipes scoped to the given company', async () => {
    const res = await request(app).get('/internal/swipes').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.swipes.length).toBeGreaterThanOrEqual(1);
    const swipe900601 = res.body.swipes.find((s: any) => s.id === 900601);
    expect(swipe900601).toBeDefined();
  });
});

describe('GET /internal/recruiter-notes', () => {
  it('returns a real seeded recruiter note', async () => {
    const res = await request(app).get('/internal/recruiter-notes').query({ companyId: 801, candidateId: 100, jobId: 200 });
    expect(res.status).toBe(200);
    expect(res.body.note.note).toBe('Strong candidate');
  });

  it('returns 404 for a non-existent note', async () => {
    const res = await request(app).get('/internal/recruiter-notes').query({ companyId: 801, candidateId: 999, jobId: 999 });
    expect(res.status).toBe(404);
  });
});

describe('GET /internal/detailed-scoring-reports', () => {
  it('returns a real seeded detailed scoring report', async () => {
    const res = await request(app).get('/internal/detailed-scoring-reports').query({ companyId: 801, candidateId: 100, jobId: 200 });
    expect(res.status).toBe(200);
    expect(res.body.report.report).toEqual({ score: 90 });
  });
});

describe('GET /internal/swipes/counts-by-job (remaining-monolith migration, Item 1)', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/swipes/counts-by-job');
    expect(res.status).toBe(400);
  });

  it('returns swipe counts aggregated per job for the given company', async () => {
    const res = await request(app).get('/internal/swipes/counts-by-job').query({ companyId: 801 });
    expect(res.status).toBe(200);
    expect(res.body.counts).toHaveLength(2);

    // Job 200 has 1 swipe with action 1 (accepted)
    const job200Counts = res.body.counts.find((c: any) => c.jobId === 200);
    expect(job200Counts).toBeDefined();
    expect(job200Counts.reviewed).toBe(1);
    expect(job200Counts.accepted).toBe(1);
    expect(job200Counts.rejected).toBe(0);
    expect(job200Counts.saved).toBe(0);

    // Job 300 has 5 swipes: 3 with action 0 (rejected), 1 with action 1 (accepted), 1 with action 0.5 (saved)
    const job300Counts = res.body.counts.find((c: any) => c.jobId === 300);
    expect(job300Counts).toBeDefined();
    expect(job300Counts.reviewed).toBe(5);
    expect(job300Counts.accepted).toBe(1);
    expect(job300Counts.rejected).toBe(3);
    expect(job300Counts.saved).toBe(1);
  });

  it('returns empty array for a company with no swipes', async () => {
    const res = await request(app).get('/internal/swipes/counts-by-job').query({ companyId: 999 });
    expect(res.status).toBe(200);
    expect(res.body.counts).toHaveLength(0);
  });
});
