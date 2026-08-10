/**
 * Integration tests for GET /api/proficiency-analytics and GET /api/shadow-data-health (Batch 25)
 * - real HTTP against a real database seeded with proficiency_shadow_scores rows (this service's
 * own dual-written mirror, so seeding directly via `pool` stands in for dual-write having already
 * run) and a real, minimal stand-in for the monolith's /internal/matching-evaluation/job-titles
 * endpoint (shadow-data-health's only proxy dependency).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const adminCookie = () => `access_token=${jwt.sign({ user_id: 601, email: 'admin@tejoma.com', name: 'Admin', company_id: 801, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`;
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 602, email: 'r@tejoma.com', name: 'Recruiter', company_id: 801, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const candidateCookie = () => `access_token=${jwt.sign({ user_id: 603, email: 'c@tejoma.com', name: 'Candidate', company_id: 801, role: 'candidate' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));

  await pool.query(
    `INSERT INTO proficiency_shadow_scores (
       company_id, candidate_id, job_id, base_match_score, proficiency_adjusted_score,
       overall_multiplier, skill_multipliers, decision_action, career_progression_type,
       recency_role_expectation, reasoning_coverage_signal
     ) VALUES
       (801, 1, 900, 70, 84, 1.2, '[{"skill":"React","multiplier":1.2}]', 1, 'ascending', 'meets', 1),
       (801, 2, 900, 50, 45, 0.9, '[{"skill":"SQL","multiplier":0.9}]', 0, 'lateral', 'exceeds', 0.4),
       (801, 3, 901, 60, 60, 1.0, '[]', null, null, null, null)`
  );
});

afterAll(async () => {
  await monolith.close();
  await pool.query('DELETE FROM proficiency_shadow_scores WHERE company_id = 801');
  await pool.end();
});

describe('GET /api/proficiency-analytics', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/proficiency-analytics');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate session with 403 (recruiter/admin only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/proficiency-analytics').set('Cookie', candidateCookie());
    expect(res.status).toBe(403);
  });

  it('computes real acceptance-rate and score-movement stats from the company\'s own shadow scores', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/proficiency-analytics').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.totalShadowScores).toBe(3);
    expect(res.body.career.acceptanceRateByProgressionType.length).toBeGreaterThan(0);
    expect(res.body.recency.acceptanceRateByRoleExpectation.length).toBeGreaterThan(0);
  });
});

describe('GET /api/shadow-data-health', () => {
  it('rejects a candidate session with 403 (recruiter/admin only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/shadow-data-health').set('Cookie', candidateCookie());
    expect(res.status).toBe(403);
  });

  it('reports real volume/segment stats, proxying job titles for seniority inference', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/matching-evaluation/job-titles': {
        status: 200,
        body: { jobs: [{ id: 900, title: 'Senior Backend Engineer' }, { id: 901, title: 'Junior QA Analyst' }] },
      },
    };
    const res = await request(app).get('/api/shadow-data-health').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.volume.totalRows).toBe(3);
    expect(res.body.volume.rowsWithDecision).toBe(2);
    expect(res.body.volume.distinctCandidates).toBe(3);
    expect(res.body.segmentSpread.bySeniority.some((s: any) => s.segment === 'senior')).toBe(true);
    const received = monolith.received.find((r) => r.url.includes('job-titles'));
    expect(received?.url).toContain('companyId=801');
    expect(received?.url).toContain('jobIds=900,901');
  });
});
