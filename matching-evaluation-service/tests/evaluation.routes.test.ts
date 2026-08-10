/**
 * Integration tests for /api/ml/evaluate, /api/ml/evaluate/history, /api/ml/train/ranking, and
 * /api/ml/ranking/status - real HTTP against a real, minimal stand-in for the monolith's
 * /internal/matching-evaluation/* API (tests/helpers/mockMonolith.ts) for swipe/candidate/job/
 * score-batch data, and a real database for this service's own match_evaluation_runs/
 * ltr_model_versions tables. MATCHING_ML_SERVICE_URL is deliberately pointed at an unreachable
 * port - the real Python Learning-to-Rank service genuinely runs via docker-compose in local dev
 * (unlike CI), and letting these tests hit it for real would mean POSTing throwaway fake training
 * data into a real, shared model - a genuine side effect, not something a test should risk causing
 * incidentally. Forcing it unreachable exercises this service's real graceful-degradation path
 * deterministically instead (trainRanking/getRankerHealth already return null on failure, never a
 * fabricated success), the same discipline the monolith's own copy has always had.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const adminCookie = () => `access_token=${jwt.sign({ user_id: 501, email: 'admin@tejoma.com', name: 'Admin', company_id: 701, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`;
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 502, email: 'r@tejoma.com', name: 'Recruiter', company_id: 701, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable - see header comment
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
  await pool.query('DELETE FROM match_evaluation_runs WHERE company_id = 701');
  await pool.query("DELETE FROM ltr_model_versions WHERE version LIKE 'ltr-%'");
  await pool.end();
});

describe('POST /api/ml/evaluate', () => {
  it('rejects a recruiter session with 403 (admin only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/ml/evaluate').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('computes real ranking-quality metrics from proxied swipe data and saves a run', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/matching-evaluation/swipes-for-evaluation': {
        status: 200,
        body: {
          swipes: [
            { id: 1, company_id: 701, recruiter_id: 501, candidate_id: 1, job_id: 900, action: 1, match_score: 90, timestamp: new Date().toISOString(), used_for_training: true },
            { id: 2, company_id: 701, recruiter_id: 501, candidate_id: 2, job_id: 900, action: 0, match_score: 40, timestamp: new Date().toISOString(), used_for_training: true },
          ],
        },
      },
    };
    const res = await request(app).post('/api/ml/evaluate').set('Cookie', adminCookie()).send({ k: 5 });
    expect(res.status).toBe(200);
    expect(res.body.company_id).toBe(701);
    expect(res.body.jobs_evaluated).toBe(1);
    expect(res.body.swipes_evaluated).toBe(2);
    expect(res.body.k).toBe(5);
    const received = monolith.received.find((r) => r.url.includes('swipes-for-evaluation'));
    expect(received?.url).toContain('companyId=701');
  });
});

describe('GET /api/ml/evaluate/history', () => {
  it('lists saved evaluation runs for the caller\'s own company', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/ml/evaluate/history').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((r: any) => r.company_id === 701)).toBe(true);
  });
});

describe('POST /api/ml/train/ranking', () => {
  it('rejects a recruiter session with 403 (admin only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/ml/train/ranking').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('reports a real, non-fabricated skip when there is no proxied training data', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = { '/internal/matching-evaluation/training-data': { status: 200, body: { swipes: [], candidates: [], jobs: [] } } };
    const res = await request(app).post('/api/ml/train/ranking').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.trained).toBe(false);
    expect(res.body.reason).toMatch(/No swipes available/);
  });

  it('forms rank groups from proxied training data and reports the ML service as unavailable (not mocked)', async () => {
    const request = (await import('supertest')).default;
    monolith.responses = {
      '/internal/matching-evaluation/training-data': {
        status: 200,
        body: {
          swipes: [
            { id: 1, company_id: 701, recruiter_id: 501, candidate_id: 1, job_id: 900, action: 1, match_score: 90, timestamp: new Date().toISOString(), used_for_training: true },
            { id: 2, company_id: 701, recruiter_id: 501, candidate_id: 2, job_id: 900, action: 0, match_score: 40, timestamp: new Date().toISOString(), used_for_training: true },
          ],
          candidates: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
          jobs: [{ id: 900, title: 'Engineer' }],
        },
      },
      '/internal/matching-evaluation/score-batch': {
        status: 200,
        body: { results: [{ feature_score: 80, embedding_score: 0, ml_score: 80, final_score: 80, breakdown: {}, summary: '', feature_vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] }, { feature_score: 40, embedding_score: 0, ml_score: 40, final_score: 40, breakdown: {}, summary: '', feature_vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.1] }] },
      },
    };
    const res = await request(app).post('/api/ml/train/ranking').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.trained).toBe(false);
    expect(res.body.reason).toMatch(/ML service unavailable/);
    const scoreBatchCall = monolith.received.find((r) => r.url.includes('score-batch'));
    expect(scoreBatchCall).toBeTruthy();
  });
});

describe('GET /api/ml/ranking/status', () => {
  it('reports the ML service as unreachable gracefully, never a crash', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/ml/ranking/status').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.ml_service_reachable).toBe(false);
    expect(res.body.wired_into_live_scoring).toBe(false);
  });
});
