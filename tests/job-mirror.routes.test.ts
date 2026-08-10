/**
 * Integration tests for src/api/job-internal.routes.ts's new mirror-and-notify/mirror-delete
 * endpoints (write-cutover completion plan, Phase B) - real HTTP against a minimal standalone
 * Express app that mounts only this router, against the real database. Same mount-just-the-router
 * pattern as tests/candidate-core-mirror.routes.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import jobInternalRoutes from '../src/api/job-internal.routes.js';

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
app.use('/internal/job', jobInternalRoutes);

let companyId: number;
const mirroredIds: number[] = [];

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (name, company_slug) VALUES ('Job Mirror Test Co', 'job-mirror-test-co') RETURNING id`
  );
  companyId = company.rows[0].id;
});

afterAll(async () => {
  if (mirroredIds.length > 0) {
    await pool.query('DELETE FROM match_scores WHERE job_id = ANY($1)', [mirroredIds]);
    await pool.query('DELETE FROM swipes WHERE job_id = ANY($1)', [mirroredIds]);
    await pool.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = ANY($2)', ['job', mirroredIds]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [mirroredIds]);
  }
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('POST /internal/job/jobs/mirror-and-notify', () => {
  it('rejects a request with no job id', async () => {
    const res = await request(app).post('/internal/job/jobs/mirror-and-notify').send({ job: { title: 'No Id' } });
    expect(res.status).toBe(400);
  });

  it('upserts the row into this table by its explicit id - a genuinely new id inserts', async () => {
    const id = 900902;
    mirroredIds.push(id);
    const res = await request(app).post('/internal/job/jobs/mirror-and-notify').send({
      job: { id, company_id: companyId, title: 'Mirrored Job', description: 'desc', required_skills: ['Go'], status: 'open' },
      isCreate: true,
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].title).toBe('Mirrored Job');
    expect(row.rows[0].required_skills).toEqual(['Go']);
  });

  it('the same id a second time updates in place, not a duplicate insert', async () => {
    const id = 900902;
    const res = await request(app).post('/internal/job/jobs/mirror-and-notify').send({
      job: { id, company_id: companyId, title: 'Mirrored Job (Updated)', description: 'desc', required_skills: ['Go', 'Rust'], status: 'open' },
      isCreate: false,
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].title).toBe('Mirrored Job (Updated)');
    expect(row.rows[0].required_skills).toEqual(['Go', 'Rust']);
  });
});

describe('POST /internal/job/jobs/mirror-delete', () => {
  it('rejects a request with no id or companyId', async () => {
    const res = await request(app).post('/internal/job/jobs/mirror-delete').send({});
    expect(res.status).toBe(400);
  });

  it('deletes the row by id and company, cleaning up match_scores/swipes/reasoning_conclusions', async () => {
    const seeded = await pool.query(
      `INSERT INTO jobs (company_id, title, description, required_skills, status) VALUES ($1, 'To Mirror-Delete', 'desc', ARRAY['Go'], 'open') RETURNING id`,
      [companyId]
    );
    const id = seeded.rows[0].id;
    await pool.query(
      `INSERT INTO reasoning_conclusions
       (subject_type, subject_id, conclusion_text, conclusion_type, reasoning_type, evidence_chain, conclusion_confidence, derived_from)
       VALUES ($1, $2, 'test conclusion', 'test_type', 'test_reasoning', '{}', 1, 'test')`,
      ['job', id]
    );

    const res = await request(app).post('/internal/job/jobs/mirror-delete').send({ id, companyId });
    expect(res.status).toBe(200);

    const [jobRow, reasoningRow] = await Promise.all([
      pool.query('SELECT id FROM jobs WHERE id = $1', [id]),
      pool.query('SELECT id FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', ['job', id]),
    ]);
    expect(jobRow.rows).toHaveLength(0);
    expect(reasoningRow.rows).toHaveLength(0);
  });

  it('is a no-op (still 200) for an id that does not exist locally', async () => {
    const res = await request(app).post('/internal/job/jobs/mirror-delete').send({ id: 999999999, companyId });
    expect(res.status).toBe(200);
  });
});
