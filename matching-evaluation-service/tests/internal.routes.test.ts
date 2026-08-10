/**
 * Integration tests for POST /internal/compute-shadow-weighting (Batch 31) - real HTTP against a
 * real database, real ported skill/career/recency/reasoning signal modules. No external service
 * dependency (unlike Role/Reasoning services' embedding calls) - skillProficiency/skillRecency are
 * pure text analysis, so this is fully deterministic without mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

afterAll(async () => {
  await pool.query('DELETE FROM shadow_weighting_computations WHERE company_id = 850');
  await pool.end();
});

describe('POST /internal/compute-shadow-weighting', () => {
  it('requires companyId, candidate, job, matchedSkills, and baseScore', async () => {
    const res = await request(app).post('/internal/compute-shadow-weighting').send({});
    expect(res.status).toBe(400);
  });

  it('computes and stores a real shadow-weighting computation with no matched skills or career/reasoning data (fully neutral)', async () => {
    const res = await request(app)
      .post('/internal/compute-shadow-weighting')
      .send({
        companyId: 850,
        candidate: { id: 950001, company_id: 850, resume_summary: null, project_entries: null, certifications: null },
        job: { id: 960001, title: 'Backend Engineer' },
        matchedSkills: [],
        baseScore: 70,
        decisionAction: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.computation).not.toBeNull();
    expect(res.body.computation.proficiency_adjusted_score).toBe(70);
    expect(res.body.computation.overall_multiplier).toBe(1);
    expect(res.body.computation.career_multiplier).toBeNull();
    expect(res.body.computation.reasoning_adjusted_score).not.toBeNull();

    const row = await pool.query('SELECT * FROM shadow_weighting_computations WHERE candidate_id = $1', [950001]);
    expect(row.rows).toHaveLength(1);
  });

  it('computes real proficiency signal from matched skills against resume text', async () => {
    const res = await request(app)
      .post('/internal/compute-shadow-weighting')
      .send({
        companyId: 850,
        candidate: {
          id: 950002,
          company_id: 850,
          resume_summary: 'Architected and led the migration of the Python backend to a microservices architecture.',
          project_entries: null,
          certifications: null,
        },
        job: { id: 960002, title: 'Senior Backend Engineer' },
        matchedSkills: ['Python'],
        baseScore: 70,
        decisionAction: null,
      });
    expect(res.status).toBe(200);
    expect(res.body.computation.overall_multiplier).toBeGreaterThan(1);
    expect(res.body.computation.proficiency_adjusted_score).toBeGreaterThan(70);
  });
});
