/**
 * Integration tests for src/api/resume-internal.routes.ts (Batch 18) - real HTTP against a
 * minimal standalone Express app mounting only this router, against the real database. Mirrors
 * tests/candidate-internal.routes.test.ts's approach exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import resumeInternalRoutes from '../src/api/resume-internal.routes.js';

const { Pool } = pkg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_recruiting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
});

const app = express();
app.use(express.json());
app.use('/internal/resume', resumeInternalRoutes);

let candidateId: number;

beforeAll(async () => {
  const candidate = await pool.query(
    `INSERT INTO candidate_accounts (name, email, password_hash, is_active) VALUES ('Resume Internal Test Candidate', 'resume-internal-test@example.test', 'hashed', true) RETURNING id`
  );
  candidateId = candidate.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM candidate_accounts WHERE id = $1', [candidateId]);
  await pool.end();
});

describe('GET /internal/resume/candidate/:id', () => {
  it('returns 404 for a nonexistent candidate', async () => {
    const res = await request(app).get('/internal/resume/candidate/999999999');
    expect(res.status).toBe(404);
  });

  it('returns null resume fields for a candidate with no resume on file yet', async () => {
    const res = await request(app).get(`/internal/resume/candidate/${candidateId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resume_file_path: null, resume_original_filename: null });
  });
});

describe('PATCH /internal/resume/candidate/:id', () => {
  it('validates required fields', async () => {
    const res = await request(app).patch(`/internal/resume/candidate/${candidateId}`).send({ resume_file_path: 'x' });
    expect(res.status).toBe(400);
  });

  it('updates the resume file pointer for real and it is readable afterward', async () => {
    const res = await request(app)
      .patch(`/internal/resume/candidate/${candidateId}`)
      .send({ resume_file_path: '/tmp/fake/path.pdf', resume_original_filename: 'my-resume.pdf', resume_file_uploaded_at: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.resume_file_path).toBe('/tmp/fake/path.pdf');
    expect(res.body.resume_original_filename).toBe('my-resume.pdf');

    const refetch = await request(app).get(`/internal/resume/candidate/${candidateId}`);
    expect(refetch.body.resume_file_path).toBe('/tmp/fake/path.pdf');
    expect(refetch.body.resume_original_filename).toBe('my-resume.pdf');
  });

  it('returns 404 for a nonexistent candidate', async () => {
    const res = await request(app)
      .patch('/internal/resume/candidate/999999999')
      .send({ resume_file_path: '/tmp/x.pdf', resume_original_filename: 'x.pdf', resume_file_uploaded_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });
});
