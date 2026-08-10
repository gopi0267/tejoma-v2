/**
 * Integration tests for POST /internal/compute-for-candidate - real HTTP against a real database,
 * a real seeded role_profiles row (standing in for dual-write having already mirrored it from the
 * monolith's own seedRoleProfiles()), and the real ported computeCareerTrajectory pipeline. No
 * network dependency (unlike Role/Reasoning services, this pipeline calls no embedding service) -
 * fully deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

beforeAll(async () => {
  await pool.query(
    `INSERT INTO role_profiles (role_key, display_name, mandatory_skills, preferred_skills, optional_skills, common_tools, typical_responsibilities, preferred_certifications, related_roles, career_progression, embedding, source)
     VALUES ('batch30_backend_engineer', 'Backend Engineer', ARRAY['REST API','SQL'], ARRAY['Python'], ARRAY['Docker'], ARRAY['Git'], ARRAY['Build APIs'], ARRAY[]::text[], ARRAY['Full-Stack Engineer'], ARRAY['Backend Engineer','Senior Backend Engineer','Staff Engineer'], ARRAY[0.1,0.2,0.3]::double precision[], 'seed')`
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM role_profiles WHERE role_key = 'batch30_backend_engineer'");
  await pool.query('DELETE FROM career_trajectories WHERE candidate_id IN (900301, 900302)');
  await pool.end();
});

describe('POST /internal/compute-for-candidate', () => {
  it('requires candidateId and companyId', async () => {
    const res = await request(app).post('/internal/compute-for-candidate').send({});
    expect(res.status).toBe(400);
  });

  it('returns null for an empty work history - never fabricates a trajectory from no data', async () => {
    const res = await request(app)
      .post('/internal/compute-for-candidate')
      .send({ candidateId: 900301, companyId: 1, workHistory: [] });
    expect(res.status).toBe(200);
    expect(res.body.trajectory).toBeNull();
  });

  it('computes and stores a real career trajectory from a real work history', async () => {
    const res = await request(app)
      .post('/internal/compute-for-candidate')
      .send({
        candidateId: 900302,
        companyId: 1,
        workHistory: [
          { company: 'Acme', title: 'Backend Engineer', start_date: '2019-01', end_date: '2021-06', is_current: false },
          { company: 'Acme', title: 'Senior Backend Engineer', start_date: '2021-07', end_date: null, is_current: true },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.trajectory).not.toBeNull();
    expect(res.body.trajectory.candidate_id).toBe(900302);
    expect(res.body.trajectory.role_count).toBe(2);
    expect(res.body.trajectory.progression_type).toBe('ic_track');
    expect(res.body.trajectory.seniority_trend).toBe('ascending');
    expect(res.body.trajectory.trajectory_embedding).toHaveLength(16);

    const row = await pool.query('SELECT * FROM career_trajectories WHERE candidate_id = $1', [900302]);
    expect(row.rows).toHaveLength(1);
  });
});
