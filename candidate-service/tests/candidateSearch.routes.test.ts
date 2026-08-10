/**
 * Integration tests for /api/candidate-search* (Remaining-monolith migration, Step 5) - real
 * database (a seeded candidate_accounts row, real saved_candidates/candidate_profile_views
 * writes), real HTTP against real, minimal stand-ins for identity-service (last-active) and
 * matching-scoring-service (heuristic ranking), and the monolith (the one proxied endpoint,
 * tab/shortlisted). Three separate instances of the same generic mockMonolith.ts helper - same
 * pattern job-service introduced in Step 4 for its own three-upstream fan-out.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const staffCookie = (overrides: Partial<{ user_id: number; company_id: number; role: string }> = {}) =>
  `access_token=${jwt.sign(
    { user_id: 28, email: 'recruiter@example.test', name: 'Rita Recruiter', company_id: 1, role: 'recruiter', ...overrides },
    DEV_SECRET,
    { expiresIn: '15m' }
  )}`;
const candidateCookie = () =>
  `candidate_access_token=${jwt.sign({ candidate_id: 1, email: 'cand@example.test', phone: null, name: 'Cand' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let identityMock: MockMonolith;
let matchingScoringMock: MockMonolith;
let app: import('express').Express;
let pool: import('pg').Pool;
let candidateId: number;

beforeAll(async () => {
  monolith = await startMockMonolith();
  identityMock = await startMockMonolith();
  matchingScoringMock = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.IDENTITY_SERVICE_URL = identityMock.url;
  process.env.MATCHING_SCORING_SERVICE_URL = matchingScoringMock.url;

  vi.resetModules();
  ({ app } = await import('../src/server.js'));
  ({ pool } = await import('../src/db.js'));

  const result = await pool.query(
    `INSERT INTO candidate_accounts
       (name, email, password_hash, is_active, visible_to_recruiters, onboarding_completed_at, headline, skills, location)
     VALUES ('Search Target', 'search-target@example.test', 'hashed', true, true, NOW(), 'Backend Engineer', ARRAY['Node.js','PostgreSQL'], 'Remote')
     RETURNING id`
  );
  candidateId = result.rows[0].id;

  identityMock.nextResponse = { status: 200, body: { lastActive: {} } };
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_profile_views WHERE candidate_account_id = $1', [candidateId]);
  await pool.query('DELETE FROM saved_candidates WHERE candidate_account_id = $1', [candidateId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateId]);
  await pool.end();
  await monolith.close();
  await identityMock.close();
  await matchingScoringMock.close();
});

describe('auth gating', () => {
  it('rejects an unauthenticated request', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-search');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate self-service token (wrong auth scheme entirely)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-search').set('Cookie', candidateCookie());
    expect(res.status).toBe(401);
  });

  it('rejects a staff token with an unauthorized role', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-search').set('Cookie', staffCookie({ role: 'candidate' }));
    expect(res.status).toBe(403);
  });
});

describe('GET /api/candidate-search', () => {
  it('finds the seeded candidate without a query (no ranking call)', async () => {
    const request = (await import('supertest')).default;
    const beforeRankCalls = matchingScoringMock.received.length;
    const res = await request(app).get('/api/candidate-search').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.candidates.some((c: any) => c.id === candidateId)).toBe(true);
    expect(res.body.candidates.find((c: any) => c.id === candidateId).saved).toBe(false);
    expect(matchingScoringMock.received.length).toBe(beforeRankCalls);
  });

  it('ranks via matching-scoring-service when a query is present', async () => {
    const request = (await import('supertest')).default;
    // q=<the seeded row's unique name> - unlike a skills filter, guaranteed to match exactly this
    // one row regardless of whatever other candidate_accounts rows already exist in the real
    // database, so the mock's single-item ranked response always lines up index-for-index with
    // the one candidate actually sent.
    matchingScoringMock.nextResponse = { status: 200, body: { ranked: [{ candidate: {}, match_score: 87 }] } };
    const res = await request(app).get('/api/candidate-search?q=Search+Target').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].id).toBe(candidateId);
    expect(res.body.candidates[0].match_score).toBe(87);
    const received = matchingScoringMock.received.at(-1)!;
    const sentBody = JSON.parse(received.body);
    expect(sentBody.tier).toBe('heuristic');
    expect(sentBody.job.title).toBe('Search Target');
    expect(sentBody.candidates[0].skills).toEqual(['Node.js', 'PostgreSQL']);
  });
});

describe('save / unsave', () => {
  it('saves, reflects in tab/saved, then removes', async () => {
    const request = (await import('supertest')).default;

    const saveRes = await request(app).post(`/api/candidate-search/${candidateId}/save`).set('Cookie', staffCookie());
    expect(saveRes.status).toBe(200);

    const searchRes = await request(app).get('/api/candidate-search').set('Cookie', staffCookie());
    expect(searchRes.body.candidates.find((c: any) => c.id === candidateId).saved).toBe(true);

    const savedTabRes = await request(app).get('/api/candidate-search/tab/saved').set('Cookie', staffCookie());
    expect(savedTabRes.status).toBe(200);
    expect(savedTabRes.body.candidates.some((c: any) => c.id === candidateId)).toBe(true);

    const removeRes = await request(app).delete(`/api/candidate-search/${candidateId}/save`).set('Cookie', staffCookie());
    expect(removeRes.status).toBe(200);

    const savedTabAfter = await request(app).get('/api/candidate-search/tab/saved').set('Cookie', staffCookie());
    expect(savedTabAfter.body.candidates.some((c: any) => c.id === candidateId)).toBe(false);
  });
});

describe('GET /api/candidate-search/tab/recently-viewed and profile view', () => {
  it('recording a profile view surfaces the candidate in recently-viewed', async () => {
    const request = (await import('supertest')).default;

    const viewRes = await request(app).get(`/api/candidate-search/${candidateId}`).set('Cookie', staffCookie());
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.candidate.id).toBe(candidateId);
    expect(viewRes.body.candidate.summary).toBeDefined();

    const recentRes = await request(app).get('/api/candidate-search/tab/recently-viewed').set('Cookie', staffCookie());
    expect(recentRes.status).toBe(200);
    expect(recentRes.body.candidates.some((c: any) => c.id === candidateId)).toBe(true);
  });

  it('404s for a nonexistent candidate id', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/candidate-search/999999999').set('Cookie', staffCookie());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/candidate-search/tab/shortlisted (proxies to the monolith)', () => {
  it('forwards the company id and shapes the monolith’s raw rows the same way as every other tab', async () => {
    const request = (await import('supertest')).default;
    monolith.nextResponse = {
      status: 200,
      body: {
        candidates: [
          { id: candidateId, name: 'Search Target', headline: 'Backend Engineer', skills: ['Node.js'], updated_at: '2026-01-01T00:00:00.000Z' },
        ],
      },
    };
    const res = await request(app).get('/api/candidate-search/tab/shortlisted').set('Cookie', staffCookie());
    expect(res.status).toBe(200);
    expect(res.body.candidates[0].id).toBe(candidateId);
    expect(res.body.candidates[0].profile_strength).toBeDefined();
    const received = monolith.received.at(-1)!;
    expect(received.url).toContain('companyId=1');
  });

  it('returns 502 when the monolith is unreachable, without crashing the service', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    const res = await request(appWithDeadMonolith).get('/api/candidate-search/tab/shortlisted').set('Cookie', staffCookie());
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});
