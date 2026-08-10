/**
 * Integration tests for src/api/candidate-core-internal.routes.ts's new mirror-and-notify/
 * mirror-delete endpoints (write-cutover completion plan, Phase A) - real HTTP against a minimal
 * standalone Express app that mounts only this router, against the real database. Same
 * mount-just-the-router pattern as tests/candidate-internal.routes.test.ts.
 *
 * Scope: the reverse-mirror mechanics (explicit-id upsert/delete into this table) - not the six
 * background side effects themselves (RAG/embedding/skill-discovery/etc.), which are the same
 * already-proven, fire-and-forget monolith-local functions createCandidateWithSideEffects always
 * called; nothing about their own behavior changed here, only how they're reached.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import candidateCoreInternalRoutes from '../src/api/candidate-core-internal.routes.js';

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
app.use('/internal/candidate-core', candidateCoreInternalRoutes);

let companyId: number;
const mirroredIds: number[] = [];

beforeAll(async () => {
  const company = await pool.query(
    `INSERT INTO companies (name, company_slug) VALUES ('Candidate Mirror Test Co', 'candidate-mirror-test-co') RETURNING id`
  );
  companyId = company.rows[0].id;
});

afterAll(async () => {
  if (mirroredIds.length > 0) {
    await pool.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = ANY($2)', ['candidate', mirroredIds]);
    await pool.query('DELETE FROM candidates WHERE id = ANY($1)', [mirroredIds]);
  }
  await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await pool.end();
});

describe('POST /internal/candidate-core/candidates/mirror-and-notify', () => {
  it('rejects a request with no candidate id', async () => {
    const res = await request(app).post('/internal/candidate-core/candidates/mirror-and-notify').send({ candidate: { name: 'No Id' } });
    expect(res.status).toBe(400);
  });

  it('upserts the row into this table by its explicit id - a genuinely new id inserts', async () => {
    // A high, explicit id standing in for one candidate-core-service's own sequence would assign -
    // this endpoint must never re-run this table's own sequence.
    const id = 900901;
    mirroredIds.push(id);
    const res = await request(app).post('/internal/candidate-core/candidates/mirror-and-notify').send({
      candidate: {
        id, company_id: companyId, name: 'Mirrored Candidate', email: 'mirrored@example.test',
        skills: 'Python, Django', previous_companies: null, certifications: null,
      },
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].name).toBe('Mirrored Candidate');
    expect(row.rows[0].skills).toBe('Python, Django');
  });

  it('the same id a second time updates in place, not a duplicate insert', async () => {
    const id = 900901;
    const res = await request(app).post('/internal/candidate-core/candidates/mirror-and-notify').send({
      candidate: { id, company_id: companyId, name: 'Mirrored Candidate (Updated)', email: 'mirrored@example.test', skills: 'Python, Django, FastAPI' },
    });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT * FROM candidates WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].name).toBe('Mirrored Candidate (Updated)');
    expect(row.rows[0].skills).toBe('Python, Django, FastAPI');
  });
});

describe('POST /internal/candidate-core/candidates/mirror-delete', () => {
  it('rejects a request with no id', async () => {
    const res = await request(app).post('/internal/candidate-core/candidates/mirror-delete').send({});
    expect(res.status).toBe(400);
  });

  it('deletes the row by id', async () => {
    const seeded = await pool.query(
      `INSERT INTO candidates (company_id, name, email) VALUES ($1, 'To Mirror-Delete', 'mirror-delete@example.test') RETURNING id`,
      [companyId]
    );
    const id = seeded.rows[0].id;

    const res = await request(app).post('/internal/candidate-core/candidates/mirror-delete').send({ id });
    expect(res.status).toBe(200);

    const row = await pool.query('SELECT id FROM candidates WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(0);
  });

  it('is a no-op (still 200) for an id that does not exist locally', async () => {
    const res = await request(app).post('/internal/candidate-core/candidates/mirror-delete').send({ id: 999999999 });
    expect(res.status).toBe(200);
  });
});
