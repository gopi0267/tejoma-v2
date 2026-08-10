/**
 * Integration tests for /api/candidate-profile/* against a real database - inserts a real
 * candidate_accounts row, signs a real token with the same dev-only fallback secret
 * config/env.ts uses, and exercises the full read/update/experience CRUD cycle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

const DEV_SECRET = 'dev-only-insecure-secret';
let candidateId: number;

function authCookie() {
  const token = jwt.sign({ candidate_id: candidateId, email: 'jane@example.test', phone: null, name: 'Jane Doe' }, DEV_SECRET, { expiresIn: '15m' });
  return `candidate_access_token=${token}`;
}

beforeAll(async () => {
  const result = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active)
     VALUES ('Jane Doe', 'jane@example.test', 'hashed', true) RETURNING id`
  );
  candidateId = result.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_experiences WHERE candidate_account_id = $1', [candidateId]);
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateId]);
  await pool.end();
});

describe('GET /api/candidate-profile/me', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/candidate-profile/me');
    expect(res.status).toBe(401);
  });

  it('returns the profile with a computed completion percentage', async () => {
    const res = await request(app).get('/api/candidate-profile/me').set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Jane Doe');
    expect(res.body.email).toBe('jane@example.test');
    expect(res.body.completion).toHaveProperty('percent');
    expect(res.body.skills).toEqual([]);
  });

  it('returns 404 for a token referencing a nonexistent candidate', async () => {
    const token = jwt.sign({ candidate_id: 999999999, email: null, phone: null, name: 'Ghost' }, DEV_SECRET, { expiresIn: '15m' });
    const res = await request(app).get('/api/candidate-profile/me').set('Cookie', `candidate_access_token=${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/candidate-profile/me', () => {
  it('rejects an empty name', async () => {
    const res = await request(app).put('/api/candidate-profile/me').set('Cookie', authCookie()).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-array skills field', async () => {
    const res = await request(app).put('/api/candidate-profile/me').set('Cookie', authCookie()).send({ skills: 'Node.js' });
    expect(res.status).toBe(400);
  });

  it('updates real profile fields and persists them', async () => {
    const res = await request(app)
      .put('/api/candidate-profile/me')
      .set('Cookie', authCookie())
      .send({ headline: 'Senior Engineer', skills: ['Node.js', 'PostgreSQL'], open_to_work: true, current_ctc: '15 LPA' });
    expect(res.status).toBe(200);
    expect(res.body.headline).toBe('Senior Engineer');
    expect(res.body.skills).toEqual(['Node.js', 'PostgreSQL']);
    expect(res.body.current_ctc).toBe('15 LPA');

    const refetch = await request(app).get('/api/candidate-profile/me').set('Cookie', authCookie());
    expect(refetch.body.headline).toBe('Senior Engineer');
  });
});

describe('candidate-profile/experiences CRUD', () => {
  let experienceId: number;

  it('creates an experience', async () => {
    const res = await request(app)
      .post('/api/candidate-profile/experiences')
      .set('Cookie', authCookie())
      .send({ job_title: 'Backend Engineer', company: 'Acme', experience_years: 3, skills_used: ['Node.js'] });
    expect(res.status).toBe(201);
    expect(res.body.experience.job_title).toBe('Backend Engineer');
    experienceId = res.body.experience.id;
  });

  it('lists experiences including the one just created, and now reflects it in completion', async () => {
    const list = await request(app).get('/api/candidate-profile/experiences').set('Cookie', authCookie());
    expect(list.body.experiences.map((e: any) => e.id)).toContain(experienceId);

    const profile = await request(app).get('/api/candidate-profile/me').set('Cookie', authCookie());
    expect(profile.body.completion.filled).toBeGreaterThan(0);
  });

  it('updates the experience', async () => {
    const res = await request(app)
      .put(`/api/candidate-profile/experiences/${experienceId}`)
      .set('Cookie', authCookie())
      .send({ company: 'Acme Corp' });
    expect(res.status).toBe(200);
    expect(res.body.experience.company).toBe('Acme Corp');
  });

  it('rejects updating another candidate\'s experience id scoping - returns 404 for a bogus id', async () => {
    const res = await request(app).put('/api/candidate-profile/experiences/999999999').set('Cookie', authCookie()).send({ company: 'X' });
    expect(res.status).toBe(404);
  });

  it('deletes the experience', async () => {
    const res = await request(app).delete(`/api/candidate-profile/experiences/${experienceId}`).set('Cookie', authCookie());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = await request(app).get('/api/candidate-profile/experiences').set('Cookie', authCookie());
    expect(list.body.experiences.map((e: any) => e.id)).not.toContain(experienceId);
  });
});
