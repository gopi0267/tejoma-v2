/**
 * Integration tests for GET /internal/role-profiles, GET /internal/role-profiles/:roleKey, and
 * POST /internal/match-role-by-title - real HTTP against a real database seeded directly (standing
 * in for dual-write having already mirrored rows from the monolith's own seedRoleProfiles()).
 * MATCHING_ML_SERVICE_URL is deliberately left unreachable for the whole file (same discipline as
 * every prior batch's tests) - matchRoleByTitle then deterministically returns null instead of
 * depending on whatever's running locally.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db.js';

let app: import('express').Express;

beforeAll(async () => {
  process.env.MATCHING_ML_SERVICE_URL = 'http://127.0.0.1:1'; // deliberately unreachable - see header comment
  ({ app } = await import('../src/server.js'));

  await pool.query(
    `INSERT INTO role_profiles (role_key, display_name, mandatory_skills, preferred_skills, optional_skills, common_tools, typical_responsibilities, preferred_certifications, related_roles, career_progression, embedding, source)
     VALUES ('batch29_backend_engineer', 'Backend Engineer', ARRAY['REST API','SQL'], ARRAY['Python'], ARRAY['Docker'], ARRAY['Git'], ARRAY['Build APIs'], ARRAY[]::text[], ARRAY['Full-Stack Engineer'], ARRAY['Backend Engineer','Senior Backend Engineer'], ARRAY[0.1,0.2,0.3]::double precision[], 'seed')`
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM role_profiles WHERE role_key = 'batch29_backend_engineer'");
  await pool.end();
});

describe('GET /internal/role-profiles', () => {
  it('lists real seeded role profiles', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/role-profiles');
    expect(res.status).toBe(200);
    expect(res.body.profiles.some((p: any) => p.role_key === 'batch29_backend_engineer')).toBe(true);
  });
});

describe('GET /internal/role-profiles/:roleKey', () => {
  it('returns a real seeded role profile by key', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/role-profiles/batch29_backend_engineer');
    expect(res.status).toBe(200);
    expect(res.body.profile.display_name).toBe('Backend Engineer');
    expect(res.body.profile.mandatory_skills).toEqual(['REST API', 'SQL']);
  });

  it('returns 404 for an unknown role key', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/internal/role-profiles/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /internal/match-role-by-title', () => {
  it('requires a title', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/match-role-by-title').send({});
    expect(res.status).toBe(400);
  });

  it('returns null (not an error) when the embedding service is unreachable', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/internal/match-role-by-title').send({ title: 'Platform Engineer II' });
    expect(res.status).toBe(200);
    expect(res.body.match).toBeNull();
  });
});
