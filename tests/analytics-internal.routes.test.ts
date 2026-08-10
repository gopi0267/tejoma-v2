/**
 * Integration tests for src/api/analytics-internal.routes.ts (Batch 22) - real HTTP against a
 * minimal standalone Express app mounting only this router, against the real database. Mirrors
 * tests/recruiting-internal.routes.test.ts's approach exactly (see its header comment for why).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import analyticsInternalRoutes from '../src/api/analytics-internal.routes.js';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

const app = express();
app.use(express.json());
app.use('/internal/analytics', analyticsInternalRoutes);

let companyId: number;
let jobId: number;
let candidateId: number;
let userId: number;

beforeAll(async () => {
  const company = await pool.query(`INSERT INTO companies (name, company_slug) VALUES ('Analytics Internal Test Co', 'analytics-internal-test-co') RETURNING id`);
  companyId = company.rows[0].id;

  const user = await pool.query(`INSERT INTO users (email, password_hash, company_id, role, name) VALUES ('analytics-internal-test@example.test', 'hashed', $1, 'recruiter', 'Test Recruiter') RETURNING id`, [companyId]);
  userId = user.rows[0].id;

  const job = await pool.query(`INSERT INTO jobs (company_id, title, status, required_skills) VALUES ($1, 'Analytics Test Role', 'open', '{}') RETURNING id`, [companyId]);
  jobId = job.rows[0].id;

  const candidate = await pool.query(`INSERT INTO candidates (company_id, name, skills) VALUES ($1, 'Analytics Test Candidate', 'React, Node.js') RETURNING id`, [companyId]);
  candidateId = candidate.rows[0].id;

  await pool.query(
    `INSERT INTO swipes (recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id) VALUES ($1, $2, $3, 1, 85, NOW(), $4)`,
    [userId, candidateId, jobId, companyId]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE company_id = $1', [companyId]);
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('GET /internal/analytics/dashboard', () => {
  it('requires companyId', async () => {
    const res = await request(app).get('/internal/analytics/dashboard');
    expect(res.status).toBe(400);
  });

  it('returns real dashboard stats reflecting the seeded swipe', async () => {
    const res = await request(app).get(`/internal/analytics/dashboard?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.total_reviewed).toBeGreaterThanOrEqual(1);
    expect(res.body.matches_made).toBeGreaterThanOrEqual(1);
    // Both naming conventions present, per the monolith's own preserved response shape.
    expect(res.body.totalCandidatesReviewed).toBe(res.body.total_reviewed);
  });
});

describe('GET /internal/analytics/job/:jobId', () => {
  it('returns 404 for a job that does not exist in this company', async () => {
    const res = await request(app).get(`/internal/analytics/job/999999?companyId=${companyId}`);
    expect(res.status).toBe(404);
  });

  it('returns real per-job stats and skill distribution', async () => {
    const res = await request(app).get(`/internal/analytics/job/${jobId}?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.total_reviewed).toBe(1);
    expect(res.body.acceptance_rate).toBe(100);
    expect(res.body.skillDistribution.some((s: any) => s.name === 'React')).toBe(true);
  });
});

describe('GET /internal/analytics/recruiter-profile', () => {
  it('returns 404 for a user not in this company', async () => {
    const res = await request(app).get(`/internal/analytics/recruiter-profile?userId=999999&companyId=${companyId}`);
    expect(res.status).toBe(404);
  });

  it('returns real recruiter stats', async () => {
    const res = await request(app).get(`/internal/analytics/recruiter-profile?userId=${userId}&companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.swipesCount).toBe(1);
    expect(res.body.accepted).toBe(1);
    expect(res.body.status).toBe('active');
  });
});

describe('GET /internal/analytics/skills', () => {
  it('returns the real skill distribution for the company', async () => {
    const res = await request(app).get(`/internal/analytics/skills?companyId=${companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.skillDistribution.some((s: any) => s.name === 'React')).toBe(true);
  });
});
