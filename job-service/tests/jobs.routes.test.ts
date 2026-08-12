/**
 * Integration tests for the public, gateway-routed /api/jobs* surface (remaining-monolith
 * migration, Step 4). GET /jobs/:id is the real cutover: real HTTP against a real seeded job in
 * this service's own database, plus real, minimal stand-ins for candidate-core-service and
 * matching-scoring-service (tests/helpers/mockMonolith.ts, reused for both). Every other route
 * (list/create/update/delete) proxies to a real, minimal stand-in for the monolith.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';
import { generateRecruiterToken, generateCandidateToken } from './helpers/tokens.js';

const recruiterCookie = () => `access_token=${generateRecruiterToken({ company_id: 870 })}`;
const candidateCookie = () => `access_token=${generateCandidateToken({ company_id: 870 })}`;

let monolith: MockMonolith;
let candidateCore: MockMonolith;
let matchingScoring: MockMonolith;
let matchingDecision: MockMonolith;
let pool: import('pg').Pool;
let app: import('express').Express;

const JOB = {
  id: 900701,
  company_id: 870,
  title: 'Senior Backend Engineer',
  description: 'Build APIs with Node.js',
  required_skills: ['Node.js', 'PostgreSQL'],
  experience_years: 3,
  location: 'Remote',
  salary_min: 800000,
  salary_max: 1500000,
  status: 'open',
};

beforeAll(async () => {
  monolith = await startMockMonolith();
  candidateCore = await startMockMonolith();
  matchingScoring = await startMockMonolith();
  matchingDecision = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.CANDIDATE_CORE_SERVICE_URL = candidateCore.url;
  process.env.MATCHING_SCORING_SERVICE_URL = matchingScoring.url;
  process.env.MATCHING_DECISION_SERVICE_URL = matchingDecision.url;

  ({ pool } = await import('../src/db.js'));
  ({ app } = await import('../src/server.js'));

  await pool.query('INSERT INTO companies (id, name, company_slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [JOB.company_id, 'Test Company', 'test-company']);
  await pool.query(
    `INSERT INTO jobs (id, company_id, title, description, required_skills, experience_years, location, salary_min, salary_max, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [JOB.id, JOB.company_id, JOB.title, JOB.description, JOB.required_skills, JOB.experience_years, JOB.location, JOB.salary_min, JOB.salary_max, JOB.status]
  );
});

afterAll(async () => {
  await monolith.close();
  await candidateCore.close();
  await matchingScoring.close();
  await matchingDecision.close();
  await pool.query('DELETE FROM jobs WHERE id = $1', [JOB.id]);
  await pool.query('DELETE FROM companies WHERE id = $1', [JOB.company_id]);
  await pool.end();
});

describe('auth gating', () => {
  it('rejects GET /api/jobs with no token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate role (staff-only surface)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/jobs').set('Cookie', candidateCookie());
    expect(res.status).toBe(403);
  });
});

describe('GET /api/jobs (real cutover - remaining-monolith migration, Item 1)', () => {
  it('orchestrates jobs, candidate count, and swipe counts into an enriched list', async () => {
    const request = (await import('supertest')).default;
    const beforeMonolithCalls = monolith.received.length;
    candidateCore.responses['/internal/candidates/count'] = { status: 200, body: { count: 5 } };
    matchingDecision.responses['/internal/swipes/counts-by-job'] = {
      status: 200,
      body: {
        [JOB.id]: { total: 10, accepted: 2, rejected: 3, pending: 0 }
      }
    };

    const res = await request(app).get('/api/jobs').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(JOB.id);
    expect(res.body[0].title).toBe(JOB.title);
    expect(res.body[0].total_candidates).toBe(5);
    expect(res.body[0].reviewed).toBe(10);
    expect(res.body[0].accepted).toBe(2);
    expect(res.body[0].rejected).toBe(3);
    expect(res.body[0].saved).toBe(0);
    expect(res.body[0].acceptance_rate).toBe(20);

    // Zero calls to monolith for this endpoint - it's a real cutover now.
    expect(monolith.received.length).toBe(beforeMonolithCalls);

    const ccReq = candidateCore.received.at(-1)!;
    expect(ccReq.url).toContain(`companyId=${JOB.company_id}`);

    const mdReq = matchingDecision.received.at(-1)!;
    expect(mdReq.url).toContain('swipes/counts-by-job');
    expect(mdReq.url).toContain(`companyId=${JOB.company_id}`);

    delete candidateCore.responses['/internal/candidates/count'];
    delete matchingDecision.responses['/internal/swipes/counts-by-job'];
  });

  it('returns sensible defaults when swipe counts are missing', async () => {
    const request = (await import('supertest')).default;
    candidateCore.responses['/internal/candidates/count'] = { status: 200, body: { count: 3 } };
    matchingDecision.responses['/internal/swipes/counts-by-job'] = { status: 200, body: {} };

    const res = await request(app).get('/api/jobs').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body[0].reviewed).toBe(0);
    expect(res.body[0].accepted).toBe(0);
    expect(res.body[0].acceptance_rate).toBe(0);

    delete candidateCore.responses['/internal/candidates/count'];
    delete matchingDecision.responses['/internal/swipes/counts-by-job'];
  });
});

describe('POST /api/jobs (real cutover - write-cutover completion plan, Phase B)', () => {
  const createdIds: number[] = [];
  afterAll(async () => {
    if (createdIds.length > 0) await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdIds]);
  });

  it('requires title, description, and required_skills before writing anything', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/jobs').set('Cookie', recruiterCookie()).send({ title: 'No description or skills' });
    expect(res.status).toBe(400);
  });

  it('writes a real row to this service’s own database and mirrors it to the monolith', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/job/jobs/mirror-and-notify'] = { status: 200, body: { mirrored: true } };
    const res = await request(app).post('/api/jobs').set('Cookie', recruiterCookie()).send({ title: 'New Role', description: 'desc', required_skills: ['Go'] });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('New Role');
    expect(res.body.required_skills).toEqual(['Go']);
    createdIds.push(res.body.id);

    const row = await pool.query('SELECT * FROM jobs WHERE id = $1', [res.body.id]);
    expect(row.rows[0].company_id).toBe(870);

    const mirrorCall = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/job/jobs/mirror-and-notify').at(-1)!;
    const sentBody = JSON.parse(mirrorCall.body);
    expect(sentBody.job.id).toBe(res.body.id);
    expect(sentBody.isCreate).toBe(true);
    delete monolith.responses['/internal/job/jobs/mirror-and-notify'];
  });

  it('still succeeds when the monolith is unreachable - the mirror is best-effort, not required for success', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.MONOLITH_INTERNAL_URL;
    process.env.MONOLITH_INTERNAL_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');
    const { pool: poolWithDeadMonolith } = await import('../src/db.js');

    const res = await request(appWithDeadMonolith).post('/api/jobs').set('Cookie', recruiterCookie()).send({ title: 'Mirror Fails', description: 'desc', required_skills: ['Rust'] });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    const row = await poolWithDeadMonolith.query('SELECT id FROM jobs WHERE id = $1', [res.body.id]);
    expect(row.rows).toHaveLength(1);

    process.env.MONOLITH_INTERNAL_URL = originalUrl;
  });
});

describe('GET /api/jobs/:id (REAL cutover - no monolith call)', () => {
  it('fuses this service\'s own job read with candidate-core-service\'s pool and matching-scoring-service\'s ranking', async () => {
    const request = (await import('supertest')).default;
    const beforeMonolithCalls = monolith.received.length;
    candidateCore.responses['/internal/candidates/for-job-scoring'] = {
      status: 200,
      body: { candidates: [{ id: 1, company_id: 870, name: 'Strong Match', skills: ['Node.js', 'PostgreSQL'] }] },
    };
    matchingScoring.responses['/internal/rank-candidates-for-job'] = {
      status: 200,
      body: { ranked: [{ candidate: { id: 1, name: 'Strong Match' }, match_score: 92, score: { breakdown: { skills: { score: 100, matched: ['Node.js'], missing: [] } }, summary: '' } }] },
    };

    const res = await request(app).get(`/api/jobs/${JOB.id}`).set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.job.title).toBe(JOB.title);
    expect(res.body.matched_candidates).toHaveLength(1);
    expect(res.body.matched_candidates[0].match_score).toBe(92);

    // The whole point of this cutover - zero calls to the monolith for this endpoint.
    expect(monolith.received.length).toBe(beforeMonolithCalls);

    const ccReq = candidateCore.received.at(-1)!;
    expect(ccReq.url).toContain(`companyId=${JOB.company_id}`);
    expect(ccReq.url).toContain('requiredSkills=Node.js%2CPostgreSQL');

    const msReq = matchingScoring.received.at(-1)!;
    const sentBody = JSON.parse(msReq.body);
    expect(sentBody.tier).toBe('full');
    expect(sentBody.persist).toEqual({ companyId: JOB.company_id, source: 'job_detail' });
  });

  it('returns 404 for a job scoped to a different company, without calling either upstream', async () => {
    const request = (await import('supertest')).default;
    const { generateAdminToken } = await import('./helpers/tokens.js');
    const beforeCcCalls = candidateCore.received.length;
    await pool.query('INSERT INTO companies (id, name, company_slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [999, 'Company 999', 'company-999']);
    const res = await request(app).get(`/api/jobs/${JOB.id}`).set('Cookie', `access_token=${generateAdminToken({ company_id: 999 })}`);
    expect(res.status).toBe(404);
    expect(candidateCore.received.length).toBe(beforeCcCalls);
  });
});

describe('PUT /api/jobs/:id (real cutover - write-cutover completion plan, Phase B)', () => {
  it('updates the real row and mirrors it to the monolith', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/job/jobs/mirror-and-notify'] = { status: 200, body: { mirrored: true } };
    const res = await request(app).put(`/api/jobs/${JOB.id}`).set('Cookie', recruiterCookie()).send({ title: 'Updated Title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');

    const row = await pool.query('SELECT title FROM jobs WHERE id = $1', [JOB.id]);
    expect(row.rows[0].title).toBe('Updated Title');

    const mirrorCall = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/job/jobs/mirror-and-notify').at(-1)!;
    expect(JSON.parse(mirrorCall.body).isCreate).toBe(false);
    delete monolith.responses['/internal/job/jobs/mirror-and-notify'];
  });

  it('returns 404 for a job that does not exist locally, without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).put('/api/jobs/999999999').set('Cookie', recruiterCookie()).send({ title: 'X' });
    expect(res.status).toBe(404);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('DELETE /api/jobs/:id (real cutover - write-cutover completion plan, Phase B)', () => {
  it('deletes the real row and mirrors the deletion to the monolith', async () => {
    const request = (await import('supertest')).default;
    const seeded = await pool.query(
      `INSERT INTO jobs (company_id, title, description, required_skills, status) VALUES (870, 'To Delete', 'desc', ARRAY['Go'], 'open') RETURNING id`
    );
    const id = seeded.rows[0].id;
    monolith.responses['/internal/job/jobs/mirror-delete'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).delete(`/api/jobs/${id}`).set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(0);

    const mirrorCall = monolith.received.filter((r) => r.method === 'POST' && r.url === '/internal/job/jobs/mirror-delete').at(-1)!;
    expect(JSON.parse(mirrorCall.body)).toEqual({ id, companyId: 870 });
    delete monolith.responses['/internal/job/jobs/mirror-delete'];
  });

  it('returns 404 for a job that does not exist locally, without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).delete('/api/jobs/999999').set('Cookie', recruiterCookie());
    expect(res.status).toBe(404);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('upstream failure handling', () => {
  it('resilient: returns job list with count=0 when candidate-core-service is unreachable (non-fatal fire-and-forget)', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.CANDIDATE_CORE_SERVICE_URL;
    process.env.CANDIDATE_CORE_SERVICE_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadCandidateCore } = await import('../src/server.js');
    matchingDecision.responses['/internal/swipes/counts-by-job'] = { status: 200, body: { counts: [] } };
    const res = await request(appWithDeadCandidateCore).get('/api/jobs').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body[0].total_candidates).toBe(0);
    process.env.CANDIDATE_CORE_SERVICE_URL = originalUrl;
    delete matchingDecision.responses['/internal/swipes/counts-by-job'];
  });

  it('resilient: returns job list with no swipe counts when matching-decision-service is unreachable (non-fatal fire-and-forget)', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.MATCHING_DECISION_SERVICE_URL;
    process.env.MATCHING_DECISION_SERVICE_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadMatchingDecision } = await import('../src/server.js');
    candidateCore.responses['/internal/candidates/count'] = { status: 200, body: { count: 5 } };
    const res = await request(appWithDeadMatchingDecision).get('/api/jobs').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body[0].reviewed).toBe(0);
    expect(res.body[0].accepted).toBe(0);
    expect(res.body[0].rejected).toBe(0);
    expect(res.body[0].saved).toBe(0);
    process.env.MATCHING_DECISION_SERVICE_URL = originalUrl;
    delete candidateCore.responses['/internal/candidates/count'];
  });

  it('returns 502 on job detail when matching-scoring-service is unreachable, not a fabricated score', async () => {
    const request = (await import('supertest')).default;
    const originalUrl = process.env.MATCHING_SCORING_SERVICE_URL;
    process.env.MATCHING_SCORING_SERVICE_URL = 'http://127.0.0.1:1';
    vi.resetModules();
    const { app: appWithDeadScoring } = await import('../src/server.js');
    candidateCore.responses['/internal/candidates/for-job-scoring'] = { status: 200, body: { candidates: [] } };
    const res = await request(appWithDeadScoring).get(`/api/jobs/${JOB.id}`).set('Cookie', recruiterCookie());
    expect(res.status).toBe(502);
    process.env.MATCHING_SCORING_SERVICE_URL = originalUrl;
  });
});
