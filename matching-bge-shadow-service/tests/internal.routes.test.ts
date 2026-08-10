/**
 * Integration tests for POST /internal/compare - real HTTP against a real database.
 * BGE_SERVICE_URL is deliberately pointed at an unreachable address for the whole file (same
 * discipline as matching-evaluation-service's Batch 24 tests / matching-reasoning-service's Batch
 * 26 tests) - isBgeServiceAvailable then deterministically returns false, exercising the real
 * graceful-degradation path instead of depending on whether python-services/bge-retrieval-service
 * happens to be running locally.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db.js';

let app: import('express').Express;

beforeAll(async () => {
  process.env.BGE_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable - see header comment
  ({ app } = await import('../src/server.js'));
});

afterAll(async () => {
  await pool.query('DELETE FROM bge_retrieval_shadow_comparisons WHERE company_id = 901');
  await pool.end();
});

describe('POST /internal/compare', () => {
  it('requires companyId, job, and existingRanked', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/compare').send({});
    expect(res.status).toBe(400);
  });

  it('reports bgeAvailable=false and stores a real row when the BGE service is unreachable', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/compare')
      .send({
        companyId: 901,
        job: { id: 501, title: 'Backend Engineer', description: 'Node.js and Postgres', required_skills: ['Node.js', 'PostgreSQL'] },
        existingRanked: [
          { candidate: { id: 1, current_job_title: 'Software Engineer', skills: ['Node.js'], resume_summary: 'Backend dev', projects: '' }, match_score: 88 },
          { candidate: { id: 2, current_job_title: 'Frontend Engineer', skills: ['React'], resume_summary: 'Frontend dev', projects: '' }, match_score: 62 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(true);
    expect(res.body.bgeAvailable).toBe(false);
    expect(res.body.poolSize).toBe(2);

    const stored = await pool.query('SELECT * FROM bge_retrieval_shadow_comparisons WHERE company_id = 901 AND job_id = 501');
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].bge_available).toBe(false);
    expect(stored.rows[0].bge_ranking).toBeNull();
    expect(stored.rows[0].pool_size).toBe(2);
    expect(stored.rows[0].existing_ranking).toEqual([
      { candidateId: 1, score: 88 },
      { candidateId: 2, score: 62 },
    ]);
  });

  it('stores an empty-pool comparison (bgeAvailable=false, no error) when existingRanked is empty', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/internal/compare')
      .send({ companyId: 901, job: { id: 502, title: 'Empty Pool Job', description: '', required_skills: [] }, existingRanked: [] });

    expect(res.status).toBe(200);
    expect(res.body.poolSize).toBe(0);
    expect(res.body.bgeAvailable).toBe(false);

    await pool.query('DELETE FROM bge_retrieval_shadow_comparisons WHERE company_id = 901 AND job_id = 502');
  });
});
