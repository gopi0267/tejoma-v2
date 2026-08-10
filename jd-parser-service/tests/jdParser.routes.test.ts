/**
 * Integration tests for POST /api/jobs/parse-description - the service's one public route.
 * Signs tokens with the same dev-only fallback secret config/env.ts uses when JWT_SECRET isn't
 * set (matching src/utils/tokens.ts's own fallback), so no env setup is needed to exercise auth.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/server.js';

const DEV_SECRET = 'dev-only-insecure-secret';

function tokenFor(role: string) {
  return jwt.sign({ user_id: 1, email: 'recruiter@tejoma.com', name: 'Test Recruiter', company_id: 1, role }, DEV_SECRET, { expiresIn: '15m' });
}

const SAMPLE_JD = `Senior Backend Engineer

Required Skills:
5-8 Years of experience with Node.js, Java (Core Java), and PostgreSQL.

Location: Bangalore / Hybrid
Employment Type: Full-time
Salary: 18-25 LPA
`;

describe('POST /api/jobs/parse-description - auth', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).post('/api/jobs/parse-description').send({ text: SAMPLE_JD });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', 'access_token=not-a-real-token')
      .send({ text: SAMPLE_JD });
    expect(res.status).toBe(401);
  });

  it('rejects a candidate-role token (recruiter/admin only)', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('candidate')}`)
      .send({ text: SAMPLE_JD });
    expect(res.status).toBe(403);
  });

  it('accepts a recruiter-role token via the Authorization header fallback', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Authorization', `Bearer ${tokenFor('recruiter')}`)
      .send({ text: SAMPLE_JD });
    expect(res.status).toBe(200);
  });

  it('accepts an admin-role token', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('admin')}`)
      .send({ text: SAMPLE_JD });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/jobs/parse-description - request validation (byte-identical to the monolith route)', () => {
  it('rejects an empty text field with 400', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('recruiter')}`)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });

  it('rejects a missing text field with 400', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('recruiter')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects text over 50,000 characters with 400', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('recruiter')}`)
      .send({ text: 'a'.repeat(50_001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too long');
  });
});

describe('POST /api/jobs/parse-description - success shape (same as src/api/jd-parser.routes.ts)', () => {
  it('returns success:true with the parsed fields and provenance', async () => {
    const res = await request(app)
      .post('/api/jobs/parse-description')
      .set('Cookie', `access_token=${tokenFor('recruiter')}`)
      .send({ text: SAMPLE_JD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.parsed.jobTitle).toBe('Senior Backend Engineer');
    expect(res.body.parsed.minimumExperience).toBe(5);
    expect(res.body.parsed.maximumExperience).toBe(8);
    expect(res.body.parsed.salaryCurrency).toBe('INR');
    expect(res.body.sourceText).toBe(SAMPLE_JD);
    expect(Array.isArray(res.body.fieldSources)).toBe(true);
    expect(typeof res.body.parseTimeMs).toBe('number');
  });
});
