/**
 * Integration tests for /api/matches/*, /api/swipes* (Remaining-monolith migration, Step 6; POST
 * /swipes cut over to a real write in the write-cutover completion plan, Phase C) - real database
 * (seeded/written swipes rows), real HTTP against real, minimal stand-ins for job-service,
 * candidate-core-service, matching-scoring-service, and the monolith (now only reached for POST
 * /swipes's own await-but-non-fatal mirror call, not as the write-authority).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const staffCookie = (overrides: Partial<{ user_id: number; company_id: number; role: string }> = {}) =>
  `access_token=${jwt.sign(
    { user_id: 501, email: 'recruiter@example.test', name: 'Rita Recruiter', company_id: 870, role: 'recruiter', ...overrides },
    DEV_SECRET,
    { expiresIn: '15m' }
  )}`;

let monolith: MockMonolith;
let jobServiceMock: MockMonolith;
let candidateCoreMock: MockMonolith;
let matchingScoringMock: MockMonolith;
let app: import('express').Express;
let pool: import('pg').Pool;

const COMPANY_ID = 870;

beforeAll(async () => {
  monolith = await startMockMonolith();
  jobServiceMock = await startMockMonolith();
  candidateCoreMock = await startMockMonolith();
  matchingScoringMock = await startMockMonolith();

  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.JOB_SERVICE_URL = jobServiceMock.url;
  process.env.CANDIDATE_CORE_SERVICE_URL = candidateCoreMock.url;
  process.env.MATCHING_SCORING_SERVICE_URL = matchingScoringMock.url;

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
  ({ pool } = await import('../src/db.js'));

  await pool.query('DELETE FROM swipes WHERE company_id = $1', [COMPANY_ID]);
  await pool.query(
    `INSERT INTO swipes (id, recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id)
     VALUES (900801, 501, 42, 700, 0.5, 80, NOW() - INTERVAL '2 hours', $1),
            (900802, 501, 43, 700, 1, 90, NOW() - INTERVAL '1 hour', $1)`,
    [COMPANY_ID]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE company_id = $1', [COMPANY_ID]);
  await pool.end();
  await monolith.close();
  await jobServiceMock.close();
  await candidateCoreMock.close();
  await matchingScoringMock.close();
});

describe('auth gating', () => {
  it('rejects an unauthenticated request', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/swipes/stats');
    expect(res.status).toBe(401);
  });

  it('rejects a staff token with an unauthorized role', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/swipes/stats').set('Cookie', staffCookie({ role: 'candidate' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/swipes/stats (real cutover)', () => {
  it('aggregates purely from this service’s own swipes mirror, no upstream calls', async () => {
    const request = (await import('supertest')).default;
    const beforeUpstreamCalls = jobServiceMock.received.length + candidateCoreMock.received.length;
    const res = await request(app).get('/api/swipes/stats').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.total_swipes).toBe(2);
    expect(res.body.acceptance_rate).toBe(50);
    expect(res.body.average_score).toBe(85);
    expect(jobServiceMock.received.length + candidateCoreMock.received.length).toBe(beforeUpstreamCalls);
  });
});

describe('GET /api/swipes/history (real cutover)', () => {
  it('hydrates candidate/job names via job-service and candidate-core-service, oldest first', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/by-ids'] = { status: 200, body: { jobs: [{ id: 700, title: 'Senior Backend Engineer' }] } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = {
      status: 200,
      body: { candidates: [{ id: 42, name: 'Aakanksha Nalla' }, { id: 43, name: 'Rohit Kumar' }] },
    };
    const res = await request(app).get('/api/swipes/history').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // oldest first - the id: 900801 swipe (2 hours ago) precedes id: 900802 (1 hour ago)
    expect(res.body[0].id).toBe(900801);
    expect(res.body[0].candidate_name).toBe('Aakanksha Nalla');
    expect(res.body[0].job_title).toBe('Senior Backend Engineer');
    expect(res.body[1].id).toBe(900802);
    expect(res.body[1].candidate_name).toBe('Rohit Kumar');
  });
});

describe('GET /api/matches/queue/:job_id (real cutover)', () => {
  it('fuses job-service + candidate-core-service + matching-scoring-service, zero monolith calls', async () => {
    const request = (await import('supertest')).default;
    const beforeMonolithCalls = monolith.received.length;
    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer', required_skills: ['Node.js'] } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = {
      status: 200,
      body: { candidates: [{ id: 42, name: 'Aakanksha Nalla', skills: ['Node.js'] }] },
    };
    matchingScoringMock.responses['/internal/rank-candidates-for-job'] = {
      status: 200,
      body: { ranked: [{ candidate: { id: 42, name: 'Aakanksha Nalla' }, match_score: 91, score: { breakdown: { skills: { score: 100 } }, summary: 'Strong match' } }] },
    };

    const res = await request(app).get('/api/matches/queue/700').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.candidate.id).toBe(42);
    expect(res.body.match_score).toBe(91);
    expect(res.body.remaining).toBe(1);

    const rankBody = JSON.parse(matchingScoringMock.received.at(-1)!.body);
    expect(rankBody.tier).toBe('full');
    expect(rankBody.persist).toEqual({ companyId: COMPANY_ID, source: 'swipe_queue' });
    expect(monolith.received.length).toBe(beforeMonolithCalls);
  });

  it('returns an empty queue when nothing is shortlisted for the job', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/701'] = { status: 200, body: { job: { id: 701, company_id: COMPANY_ID, title: 'Empty Queue Job' } } };
    const res = await request(app).get('/api/matches/queue/701').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ candidate: null, remaining: 0 });
  });

  it('404s when the job does not exist', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/999999'] = { status: 404, body: { error: 'Job not found' } };
    const res = await request(app).get('/api/matches/queue/999999').set('Cookie', staffCookie());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/matches/score (real cutover)', () => {
  it('fetches job + candidate then scores via matching-scoring-service', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer' } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = { status: 200, body: { candidates: [{ id: 42, name: 'Aakanksha Nalla' }] } };
    matchingScoringMock.responses['/internal/score-candidate-for-job'] = {
      status: 200,
      body: { score: { feature_score: 70, embedding_score: 60, ml_score: 80, final_score: 75, breakdown: {}, summary: 'Solid' } },
    };

    const res = await request(app).post('/api/matches/score').set('Cookie', staffCookie()).send({ job_id: 700, candidate_id: 42 });
    expect(res.status).toBe(200);
    expect(res.body.final_score).toBe(75);
    expect(res.body.summary).toBe('Solid');
  });
});

describe('POST /api/swipes (real cutover, write-cutover completion plan Phase C)', () => {
  it('writes the swipe to this service’s own database and mirrors it into the monolith', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer', required_skills: ['Node.js'] } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = {
      status: 200,
      body: { candidates: [{ id: 44, name: 'New Candidate', skills: ['Node.js'] }] },
    };
    matchingScoringMock.responses['/internal/score-candidate-for-job'] = {
      status: 200,
      body: { score: { feature_score: 70, embedding_score: 60, ml_score: 80, final_score: 75, breakdown: { skills: { score: 100, matched: ['Node.js'], missing: [] } }, summary: '' } },
    };
    monolith.responses['/internal/matching-decision/swipes/mirror-and-notify'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).post('/api/swipes').set('Cookie', staffCookie()).send({ job_id: 700, candidate_id: 44, action: 1 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.match_score).toBe(75);
    // Candidate 42's seeded swipe (beforeAll) is action=0.5 ("Saved") for job 700, so it's still
    // shortlisted and pending - next_candidate reflects matching-scoring-service's mocked ranking
    // for it (same mock response the earlier "GET /api/matches/queue/:job_id" test configured;
    // MockMonolith's responses map has no per-test reset).
    expect(res.body.next_candidate).not.toBe(null);
    expect(res.body.next_candidate.candidate.id).toBe(42);

    const row = await pool.query('SELECT * FROM swipes WHERE company_id = $1 AND candidate_id = $2', [COMPANY_ID, 44]);
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0].action)).toBe(1);
    expect(Number(row.rows[0].match_score)).toBe(75);

    const mirrorCall = monolith.received.find((r) => r.url.includes('mirror-and-notify'));
    expect(mirrorCall).toBeDefined();
    const mirrorBody = JSON.parse(mirrorCall!.body);
    expect(mirrorBody.swipe.id).toBe(row.rows[0].id);
    expect(mirrorBody.swipe.company_id).toBe(COMPANY_ID);
    expect(mirrorBody.swipe.candidate_id).toBe(44);
  });

  it('still succeeds when the monolith is unreachable - mirror failures never fail the swipe', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer' } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = { status: 200, body: { candidates: [{ id: 45, name: 'Another Candidate' }] } };
    matchingScoringMock.responses['/internal/score-candidate-for-job'] = {
      status: 200,
      body: { score: { feature_score: 70, embedding_score: 60, ml_score: 80, final_score: 82, breakdown: {}, summary: '' } },
    };

    const res = await request(appWithDeadMonolith).post('/api/swipes').set('Cookie', staffCookie()).send({ job_id: 700, candidate_id: 45, action: 0 });
    expect(res.status).toBe(201);
    expect(res.body.match_score).toBe(82);

    const row = await pool.query('SELECT * FROM swipes WHERE company_id = $1 AND candidate_id = $2', [COMPANY_ID, 45]);
    expect(row.rows).toHaveLength(1);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });

  it('404s when the job or candidate is not found', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/999999'] = { status: 404, body: { error: 'Job not found' } };
    const res = await request(app).post('/api/swipes').set('Cookie', staffCookie()).send({ job_id: 999999, candidate_id: 42, action: 1 });
    expect(res.status).toBe(404);
  });

  it('400s when required swipe fields are missing', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/swipes').set('Cookie', staffCookie()).send({ job_id: 700 });
    expect(res.status).toBe(400);
  });
});
