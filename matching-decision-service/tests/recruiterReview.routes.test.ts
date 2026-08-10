/**
 * Integration tests for /api/recruiter-review* (Remaining-monolith migration, Step 6; notes/
 * detailed-score/decision cut over to real writes in the write-cutover completion plan, Phase D).
 * GET list/detail still proxy to the monolith (see recruiterReview.routes.ts's own header comment
 * for why) - those tests exercise the real HTTP proxy chain against a real, minimal stand-in
 * monolith, mirroring tests/matches.routes.test.ts's approach. POST/PATCH now write locally (real
 * database) plus fan out to real, minimal stand-ins for job-service/candidate-core-service/
 * matching-scoring-service, the same four-mock shape matches.routes.test.ts already uses.
 *
 * Mocks the Gemini SDK entirely for the detailed-score tests (no real API key available in CI -
 * same reasoning/pattern as chat-service's own tests/chat.routes.test.ts) with a deterministic
 * fake RubricReport-shaped response.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

// A class, not an arrow-function factory - arrow functions can never be used as constructors in
// JS, independent of vi.fn() wrapping (same reasoning as chat-service's own mock).
vi.mock('@google/genai', () => {
  const fakeReport = {
    detectedRole: 'Backend Engineer (Node.js)',
    factors: [{ name: 'Core Language & OOP Mastery', score: 20, maxScore: 25, weightPercent: 25, resumeEvidence: 'Node.js experience noted.', scoringLogic: 'Proficient.' }],
    calculation: '20/25*25 = 20%',
    finalScorePercent: 82,
    interpretation: 'strong',
    redFlags: [],
    recommendations: ['Schedule interview'],
  };
  class GoogleGenAI {
    models = {
      generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify(fakeReport) }),
    };
  }
  return { GoogleGenAI, Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER' } };
});

const DEV_SECRET = 'dev-only-insecure-secret';
const staffCookie = () =>
  `access_token=${jwt.sign(
    { user_id: 501, email: 'recruiter@example.test', name: 'Rita Recruiter', company_id: 871, role: 'recruiter' },
    DEV_SECRET,
    { expiresIn: '15m' }
  )}`;

let monolith: MockMonolith;
let jobServiceMock: MockMonolith;
let candidateCoreMock: MockMonolith;
let matchingScoringMock: MockMonolith;
let app: import('express').Express;
let pool: import('pg').Pool;

const COMPANY_ID = 871;

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
  await pool.query('DELETE FROM recruiter_notes WHERE company_id = $1', [COMPANY_ID]);
  await pool.query('DELETE FROM detailed_scoring_reports WHERE company_id = $1', [COMPANY_ID]);
  await pool.query(
    `INSERT INTO swipes (id, recruiter_id, candidate_id, job_id, action, match_score, "timestamp", company_id)
     VALUES (900901, 501, 42, 700, 0.5, 80, NOW() - INTERVAL '2 hours', $1)`,
    [COMPANY_ID]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM swipes WHERE company_id = $1', [COMPANY_ID]);
  await pool.query('DELETE FROM recruiter_notes WHERE company_id = $1', [COMPANY_ID]);
  await pool.query('DELETE FROM detailed_scoring_reports WHERE company_id = $1', [COMPANY_ID]);
  await pool.end();
  await monolith.close();
  await jobServiceMock.close();
  await candidateCoreMock.close();
  await matchingScoringMock.close();
});

describe('GET /api/recruiter-review (list)', () => {
  it('forwards validated query params and returns the monolith response unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-decision/recruiter-review'] = {
      status: 200,
      body: { data: [{ swipe_id: 1 }], page: 1, pageSize: 25, totalRecords: 1, totalPages: 1, stats: { totalReviewed: 1 } },
    };
    const res = await request(app).get('/api/recruiter-review?jobId=700&decision=accepted').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ swipe_id: 1 }]);
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('companyId=871');
    expect(received.url).toContain('jobId=700');
    expect(received.url).toContain('decision=accepted');
    // This mock matches by prefix (tests/helpers/mockMonolith.ts) - '/internal/matching-decision/
    // recruiter-review' is itself a prefix of every other recruiter-review path this test file
    // registers below, so it must be removed once this test is done or it will shadow them all
    // (first-inserted-key-that-matches wins).
    delete monolith.responses['/internal/matching-decision/recruiter-review'];
  });

  it('422s on an invalid query param before ever calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const beforeCount = monolith.received.length;
    const res = await request(app).get('/api/recruiter-review?decision=bogus').set('Cookie', staffCookie());
    expect(res.status).toBe(422);
    expect(monolith.received.length).toBe(beforeCount);
  });
});

describe('GET /api/recruiter-review/:candidateId/:jobId (detail)', () => {
  it('forwards the ids and returns the monolith response unchanged', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-decision/recruiter-review/42/700'] = {
      status: 200,
      body: { swipe_id: 1, explanation: { summary: 'Great fit' } },
    };
    const res = await request(app).get('/api/recruiter-review/42/700').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.explanation.summary).toBe('Great fit');
    // Also a prefix of '/internal/matching-decision/recruiter-review/42/700/detailed-score',
    // registered later in this file - same reason as the list describe block's own cleanup above.
    delete monolith.responses['/internal/matching-decision/recruiter-review/42/700'];
  });

  it('404s when the monolith reports not found', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-decision/recruiter-review/99/700'] = { status: 404, body: { error: 'Candidate or job not found' } };
    const res = await request(app).get('/api/recruiter-review/99/700').set('Cookie', staffCookie());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/recruiter-review/:id/notes (real cutover, write-cutover completion plan Phase D)', () => {
  it('resolves the swipe id to candidate/job, writes locally, and mirrors into the monolith', async () => {
    const request = (await import('supertest')).default;
    monolith.responses['/internal/matching-decision/recruiter-review/notes/mirror-and-notify'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).post('/api/recruiter-review/900901/notes').set('Cookie', staffCookie()).send({ note: 'Strong candidate' });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe('Strong candidate');
    expect(res.body.candidate_id).toBe(42);
    expect(res.body.job_id).toBe(700);

    const row = await pool.query('SELECT * FROM recruiter_notes WHERE company_id = $1 AND candidate_id = 42 AND job_id = 700', [COMPANY_ID]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].note).toBe('Strong candidate');

    const mirrorCall = monolith.received.find((r) => r.url.includes('notes/mirror-and-notify'));
    expect(mirrorCall).toBeDefined();
    const mirrorBody = JSON.parse(mirrorCall!.body);
    expect(mirrorBody.note.id).toBe(row.rows[0].id);
    expect(mirrorBody.note.candidate_id).toBe(42);
  });

  it('upserts in place on a second call for the same pair, not a duplicate row', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/recruiter-review/900901/notes').set('Cookie', staffCookie()).send({ note: 'Updated note' });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe('Updated note');

    const rows = await pool.query('SELECT * FROM recruiter_notes WHERE company_id = $1 AND candidate_id = 42 AND job_id = 700', [COMPANY_ID]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].note).toBe('Updated note');
  });

  it('422s on an empty note before touching the database', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/recruiter-review/900901/notes').set('Cookie', staffCookie()).send({ note: '' });
    expect(res.status).toBe(422);
  });

  it('404s when the swipe id does not exist locally', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/recruiter-review/999999999/notes').set('Cookie', staffCookie()).send({ note: 'Anything' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/recruiter-review/:candidateId/:jobId/detailed-score (real cutover, write-cutover completion plan Phase D)', () => {
  it('resolves candidate/job, generates a report, writes locally, and mirrors into the monolith', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer', required_skills: ['Node.js'] } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = {
      status: 200,
      body: { candidates: [{ id: 42, name: 'Aakanksha Nalla', skills: ['Node.js'], resume_text: 'Experienced Node.js engineer.' }] },
    };
    monolith.responses['/internal/matching-decision/recruiter-review/detailed-score/mirror-and-notify'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).post('/api/recruiter-review/42/700/detailed-score').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.detailedScore).toBeDefined();
    expect(res.body.detailedScore.finalScorePercent).toBeTypeOf('number');
    expect(res.body.detailedScoreGeneratedAt).toBeDefined();

    const row = await pool.query('SELECT * FROM detailed_scoring_reports WHERE company_id = $1 AND candidate_id = 42 AND job_id = 700', [COMPANY_ID]);
    expect(row.rows).toHaveLength(1);

    const mirrorCall = monolith.received.find((r) => r.url.includes('detailed-score/mirror-and-notify'));
    expect(mirrorCall).toBeDefined();
    const mirrorBody = JSON.parse(mirrorCall!.body);
    expect(mirrorBody.report.id).toBe(row.rows[0].id);
    expect(mirrorBody.report.candidate_id).toBe(42);
  });

  it('404s when the candidate or job is not found', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/999999'] = { status: 404, body: { error: 'Job not found' } };
    const res = await request(app).post('/api/recruiter-review/42/999999/detailed-score').set('Cookie', staffCookie());
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/recruiter-review/:id/decision (real cutover, write-cutover completion plan Phase D)', () => {
  it('records a new swipe row via db.recordSwipe and mirrors with source: decision-change', async () => {
    const request = (await import('supertest')).default;
    jobServiceMock.responses['/internal/jobs/700'] = { status: 200, body: { job: { id: 700, company_id: COMPANY_ID, title: 'Senior Backend Engineer', required_skills: ['Node.js'] } } };
    candidateCoreMock.responses['/internal/candidates/by-ids'] = {
      status: 200,
      body: { candidates: [{ id: 42, name: 'Aakanksha Nalla', skills: ['Node.js'] }] },
    };
    matchingScoringMock.responses['/internal/score-candidate-for-job'] = {
      status: 200,
      body: { score: { feature_score: 70, embedding_score: 60, ml_score: 80, final_score: 91, breakdown: { skills: { score: 100, matched: ['Node.js'], missing: [] } }, summary: '' } },
    };
    monolith.responses['/internal/matching-decision/swipes/mirror-and-notify'] = { status: 200, body: { mirrored: true } };

    const res = await request(app).patch('/api/recruiter-review/900901/decision').set('Cookie', staffCookie()).send({ action: 'accepted', reason: 'Great fit' });
    expect(res.status).toBe(200);
    expect(Number(res.body.action)).toBe(1);
    expect(res.body.match_score).toBe(91);
    expect(res.body.candidate_id).toBe(42);
    expect(res.body.job_id).toBe(700);
    expect(res.body.reason).toBe('Great fit');
    // A brand new row, never an update-in-place of the original swipe (900901) - preserves the
    // full audit history, same guarantee the original monolith route always made.
    expect(res.body.id).not.toBe(900901);

    const mirrorCall = monolith.received.find((r) => r.url.includes('/swipes/mirror-and-notify'));
    expect(mirrorCall).toBeDefined();
    const mirrorBody = JSON.parse(mirrorCall!.body);
    expect(mirrorBody.source).toBe('decision-change');
    expect(mirrorBody.swipe.id).toBe(res.body.id);
  });

  it('422s on an invalid action before ever touching the database', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).patch('/api/recruiter-review/900901/decision').set('Cookie', staffCookie()).send({ action: 'bogus' });
    expect(res.status).toBe(422);
  });

  it('404s when the swipe id does not exist locally', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).patch('/api/recruiter-review/999999999/decision').set('Cookie', staffCookie()).send({ action: 'accepted' });
    expect(res.status).toBe(404);
  });
});

describe('upstream failure handling', () => {
  it('returns 502 on GET /recruiter-review when the monolith is unreachable, without crashing the service', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    const res = await request(appWithDeadMonolith).get('/api/recruiter-review').set('Cookie', staffCookie());
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});
