/**
 * Integration tests for /api/chat and /api/chat/reindex. Mocks the Gemini SDK entirely (no real
 * API key available in CI - see .github/workflows/ci.yml's comment) with a deterministic fake
 * implementation, and uses a real, minimal stand-in for the monolith's /internal/chat/* API
 * (tests/helpers/mockMonolith.ts) so monolithClient.ts's actual network code is exercised for
 * real. Auth/validation is real throughout - only the two genuinely external dependencies
 * (Gemini, the monolith) are stood in for.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 1, email: 'r@tejoma.com', name: 'Recruiter', company_id: 1, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const adminCookie = () => `access_token=${jwt.sign({ user_id: 2, email: 'a@tejoma.com', name: 'Admin', company_id: 1, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`;

// A class, not an arrow-function factory - arrow functions can never be used as constructors in
// JS (`new (() => {})()` always throws "is not a constructor"), independent of vi.fn() wrapping.
vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = {
      generateContent: vi.fn().mockResolvedValue({ text: 'Mocked assistant reply about the platform stats.' }),
      embedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: Array.from({ length: 768 }, () => 0.01) }] }),
    };
  }
  return { GoogleGenAI };
});

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  monolith.responses = {
    '/internal/chat/stats': { status: 200, body: { candidateCount: 42, jobCount: 7 } },
    '/internal/chat/candidates-unscoped': { status: 200, body: { candidates: [{ id: 1, company_id: 1, name: 'Test Candidate' }] } },
    '/internal/chat/jobs-unscoped': { status: 200, body: { jobs: [{ id: 1, company_id: 1, title: 'Test Job' }] } },
  };
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
  // The reindex test below writes real rows via the real ragService/db.ts path (candidate id 1,
  // job id 1, from mockMonolith's fixed candidates-unscoped/jobs-unscoped responses) - harmless
  // in CI's fresh ephemeral Postgres, but clean up so repeated local runs don't accumulate rows.
  await pool.query(`DELETE FROM knowledge_base_chunks WHERE source_type = 'candidate' AND source_id = 1`);
  await pool.query(`DELETE FROM knowledge_base_chunks WHERE source_type = 'job' AND source_id = 1`);
  await pool.end();
});

describe('POST /api/chat - auth', () => {
  it('rejects a request with no token', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects a candidate-role token (recruiter/admin only)', async () => {
    const request = (await import('supertest')).default;
    const token = jwt.sign({ user_id: 3, email: null, name: 'C', company_id: 1, role: 'candidate' }, DEV_SECRET, { expiresIn: '15m' });
    const res = await request(app).post('/api/chat').set('Cookie', `access_token=${token}`).send({ message: 'hi' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/chat - validation', () => {
  it('rejects an empty message', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/chat').set('Cookie', recruiterCookie()).send({ message: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat - success (real DB retrieval + mocked Gemini + real monolith call for stats)', () => {
  it('returns a reply and sources, having fetched platform stats from the monolith', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/chat').set('Cookie', recruiterCookie()).send({ message: 'How many candidates do we have?' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('Mocked assistant reply about the platform stats.');
    expect(Array.isArray(res.body.sources)).toBe(true);

    const statsCall = monolith.received.find((r) => r.url.startsWith('/internal/chat/stats'));
    expect(statsCall).toBeDefined();
    expect(statsCall!.url).toContain('companyId=1');
  });

  it('returns 502 when the monolith is unreachable for stats', async () => {
    const request = (await import('supertest')).default;
    const deadMonolith = await startMockMonolith();
    await deadMonolith.close();
    process.env.MONOLITH_INTERNAL_URL = deadMonolith.url;
    vi.resetModules();
    const { app: appWithDeadMonolith } = await import('../src/server.js');

    const res = await request(appWithDeadMonolith).post('/api/chat').set('Cookie', recruiterCookie()).send({ message: 'hi' });
    expect(res.status).toBe(502);

    process.env.MONOLITH_INTERNAL_URL = monolith.url;
  });
});

describe('POST /api/chat/reindex', () => {
  it('is admin-only - a recruiter gets 403', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/chat/reindex').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('admin can trigger a reindex, pulling unscoped candidates/jobs from the monolith', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/chat/reindex').set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.candidates.indexed).toBe(1);
    expect(res.body.jobs.indexed).toBe(1);

    expect(monolith.received.some((r) => r.url.startsWith('/internal/chat/candidates-unscoped'))).toBe(true);
    expect(monolith.received.some((r) => r.url.startsWith('/internal/chat/jobs-unscoped'))).toBe(true);
  });
});
