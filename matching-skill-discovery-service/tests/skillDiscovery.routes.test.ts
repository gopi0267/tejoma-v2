/**
 * Integration tests for GET /api/skills/discovery/pending, POST .../approve, POST .../reject, and
 * POST /internal/discover - real HTTP against a real database, a real (mocked-SDK) Gemini call
 * (same vi.mock convention resume-service/chat-service already use, since CI has no real API key),
 * and a real, minimal stand-in for the monolith's /internal/skill-discovery/promote endpoint.
 *
 * MATCHING_ML_SERVICE_URL is deliberately left unreachable for the whole file (same discipline as
 * matching-evaluation-service's Batch 24 tests) - findNearestNeighbors then deterministically
 * returns [] instead of depending on whatever's running locally.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { startMockMonolith, type MockMonolith } from './helpers/mockMonolith.js';
import { pool } from '../src/db.js';

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI, Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY', BOOLEAN: 'BOOLEAN' } };
});

const DEV_SECRET = 'dev-only-insecure-secret';
const adminCookie = () => `access_token=${jwt.sign({ user_id: 701, email: 'admin@tejoma.com', name: 'Admin', company_id: 801, role: 'admin' }, DEV_SECRET, { expiresIn: '15m' })}`;
const recruiterCookie = () => `access_token=${jwt.sign({ user_id: 702, email: 'r@tejoma.com', name: 'Recruiter', company_id: 801, role: 'recruiter' }, DEV_SECRET, { expiresIn: '15m' })}`;
const candidateCookie = () => `access_token=${jwt.sign({ user_id: 703, email: 'c@tejoma.com', name: 'Candidate', company_id: 801, role: 'candidate' }, DEV_SECRET, { expiresIn: '15m' })}`;

let monolith: MockMonolith;
let app: import('express').Express;

beforeAll(async () => {
  monolith = await startMockMonolith();
  process.env.MONOLITH_INTERNAL_URL = monolith.url;
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable - see header comment
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  vi.resetModules();
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await monolith.close();
  await pool.query("DELETE FROM skill_discovery_proposals WHERE raw_token LIKE 'Batch27%'");
  await pool.end();
});

describe('GET /api/skills/discovery/pending', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/skills/discovery/pending');
    expect(res.status).toBe(401);
  });

  it('rejects a candidate session with 403', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/skills/discovery/pending').set('Cookie', candidateCookie());
    expect(res.status).toBe(403);
  });

  it('lists real pending proposals for a recruiter session', async () => {
    const request = (await import('supertest')).default;
    await pool.query(
      `INSERT INTO skill_discovery_proposals (raw_token, normalized_token, source_type, is_skill, proposed_category, confidence, status)
       VALUES ('Batch27Tool', 'batch27tool', 'resume', true, 'tool', 0.4, 'pending')`
    );
    const res = await request(app).get('/api/skills/discovery/pending').set('Cookie', recruiterCookie());
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.raw_token === 'Batch27Tool')).toBe(true);
  });
});

describe('POST /api/skills/discovery/:id/approve', () => {
  it('rejects a recruiter session with 403 (admin only)', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/skills/discovery/1/approve').set('Cookie', recruiterCookie());
    expect(res.status).toBe(403);
  });

  it('promotes a real pending proposal via the monolith proxy (real skill_nodes write happens there, not here)', async () => {
    const request = (await import('supertest')).default;
    const created = await pool.query(
      `INSERT INTO skill_discovery_proposals (raw_token, normalized_token, source_type, is_skill, proposed_category, confidence, status)
       VALUES ('Batch27Approve', 'batch27approve', 'resume', true, 'tool', 0.6, 'pending') RETURNING id`
    );
    const proposalId = created.rows[0].id;

    monolith.responses = {
      '/internal/skill-discovery/promote': {
        status: 200,
        body: { skill_node: { id: 9001, canonical_name: 'Batch27Approve', category: 'tool', technology_domain: 'Developer Tooling', aliases: ['Batch27Approve'], popularity_score: 0, confidence: 0.6, is_deprecated: false, is_emerging: true, source: 'unknown_skill_discovery', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
      },
    };

    const res = await request(app).post(`/api/skills/discovery/${proposalId}/approve`).set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.skill_node.id).toBe(9001);

    const promoteCall = monolith.received.find((r) => r.url.includes('/internal/skill-discovery/promote'));
    expect(promoteCall).toBeTruthy();
    expect(JSON.parse(promoteCall!.body).rawToken).toBe('Batch27Approve');

    const stored = await pool.query('SELECT status, promoted_skill_node_id FROM skill_discovery_proposals WHERE id = $1', [proposalId]);
    expect(stored.rows[0].status).toBe('approved');
    expect(stored.rows[0].promoted_skill_node_id).toBe(9001);
  });

  it('returns 404 for a non-pending proposal', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/skills/discovery/999999/approve').set('Cookie', adminCookie());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/skills/discovery/:id/reject', () => {
  it('rejects a real pending proposal without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    const created = await pool.query(
      `INSERT INTO skill_discovery_proposals (raw_token, normalized_token, source_type, is_skill, proposed_category, confidence, status)
       VALUES ('Batch27Reject', 'batch27reject', 'resume', true, 'tool', 0.3, 'pending') RETURNING id`
    );
    const proposalId = created.rows[0].id;

    const callsBefore = monolith.received.length;
    const res = await request(app).post(`/api/skills/discovery/${proposalId}/reject`).set('Cookie', adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('rejected');
    expect(monolith.received.length).toBe(callsBefore);
  });
});

describe('POST /internal/discover', () => {
  it('requires rawSkills and a valid sourceType', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/discover').send({});
    expect(res.status).toBe(400);
  });

  it('classifies a new token as not-a-skill via the (mocked) Gemini call and stores it, without calling the monolith', async () => {
    const request = (await import('supertest')).default;
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ isSkill: false }) });

    const callsBefore = monolith.received.length;
    const res = await request(app).post('/internal/discover').send({ rawSkills: ['Batch27NotASkillXYZ'], contextText: 'irrelevant buzzword', sourceType: 'resume' });
    expect(res.status).toBe(200);
    expect(res.body.outcomes[0].status).toBe('not_a_skill');
    expect(monolith.received.length).toBe(callsBefore);

    const stored = await pool.query('SELECT status FROM skill_discovery_proposals WHERE normalized_token = $1', ['batch27notaskillxyz']);
    expect(stored.rows[0].status).toBe('not_a_skill');
  });

  it('never calls the monolith promote endpoint even when a second sighting crosses the auto-promote threshold (skipPromotion=true)', async () => {
    const request = (await import('supertest')).default;
    // Seed a pending proposal with a stored nearest-neighbor similarity high enough that a second
    // sighting's recomputed confidence crosses AUTO_PROMOTE_THRESHOLD (0.75) - this exercises the
    // "existing pending" branch's confidence recompute without depending on a live embedding call.
    await pool.query(
      `INSERT INTO skill_discovery_proposals (raw_token, normalized_token, source_type, is_skill, proposed_category, nearest_neighbors, confidence, status, mention_count)
       VALUES ('Batch27ShadowPromote', 'batch27shadowpromote', 'resume', true, 'tool', $1, 0.72, 'pending', 1)`,
      [JSON.stringify([{ skillNodeId: 1, canonicalName: 'Existing', similarity: 0.95 }])]
    );

    const callsBefore = monolith.received.length;
    const res = await request(app).post('/internal/discover').send({ rawSkills: ['Batch27ShadowPromote'], contextText: '', sourceType: 'resume' });
    expect(res.status).toBe(200);
    expect(res.body.outcomes[0].status).toBe('auto_promoted');
    expect(res.body.outcomes[0].promotedSkillNodeId).toBeNull();
    // The whole point of skipPromotion=true: no real monolith write from a shadow-triggered call.
    expect(monolith.received.length).toBe(callsBefore);

    const stored = await pool.query('SELECT status, promoted_skill_node_id FROM skill_discovery_proposals WHERE normalized_token = $1', ['batch27shadowpromote']);
    expect(stored.rows[0].status).toBe('auto_promoted');
    expect(stored.rows[0].promoted_skill_node_id).toBeNull();
  });
});
