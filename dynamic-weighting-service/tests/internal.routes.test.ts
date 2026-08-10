/**
 * Integration tests for every /internal/* endpoint (Batch 33) - real HTTP against a real database
 * seeded directly (standing in for dual-write having already mirrored rows from the monolith).
 * Fully deterministic - no external service dependency anywhere in this service.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool } from '../src/db.js';

beforeAll(async () => {
  await pool.query(
    `INSERT INTO role_profiles (role_key, display_name, mandatory_skills, preferred_skills, optional_skills, common_tools, typical_responsibilities, preferred_certifications, related_roles, career_progression, embedding, source)
     VALUES ('batch33_backend_engineer', 'Backend Engineer', ARRAY['REST API'], ARRAY['Docker'], ARRAY['Kubernetes'], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, 'seed')`
  );
  const python = await pool.query(
    `INSERT INTO skill_nodes (canonical_name, category, aliases, popularity_score, confidence, source)
     VALUES ('Python', 'language', ARRAY['py'], 1, 1, 'dictionary') RETURNING id`
  );
  const django = await pool.query(
    `INSERT INTO skill_nodes (canonical_name, category, aliases, popularity_score, confidence, source)
     VALUES ('Django', 'framework', ARRAY[]::text[], 1, 1, 'dictionary') RETURNING id`
  );
  await pool.query(
    `INSERT INTO skill_edges (from_skill_id, to_skill_id, relationship_type, weight, source)
     VALUES ($1, $2, 'FRAMEWORK_OF', 1, 'curated')`,
    [django.rows[0].id, python.rows[0].id]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM role_profiles WHERE role_key = 'batch33_backend_engineer'");
  await pool.query("DELETE FROM skill_edges WHERE source = 'curated'");
  await pool.query("DELETE FROM skill_nodes WHERE canonical_name IN ('Python', 'Django')");
  await pool.end();
});

describe('POST /internal/resolve-skill-tiers', () => {
  it('requires a job', async () => {
    const res = await request(app).post('/internal/resolve-skill-tiers').send({});
    expect(res.status).toBe(400);
  });

  it('fills preferred tier from a lexically-matched role profile', async () => {
    const res = await request(app)
      .post('/internal/resolve-skill-tiers')
      .send({ job: { id: 1, title: 'Backend Engineer', required_skills: ['SQL'], optional_skills: [] } });
    expect(res.status).toBe(200);
    expect(res.body.tiers.mandatory).toEqual(['SQL']);
    expect(res.body.tiers.preferred).toContain('REST API');
    expect(res.body.tiers.roleMatch.role.role_key).toBe('batch33_backend_engineer');
  });
});

describe('POST /internal/compute-seniority-weights', () => {
  it('returns the base weights unchanged when no experience is required', async () => {
    const res = await request(app)
      .post('/internal/compute-seniority-weights')
      .send({ job: { min_experience: null, experience_years: null } });
    expect(res.status).toBe(200);
    expect(res.body.weights).toEqual({ skillWeight: 0.4, experienceWeight: 0.35, locationWeight: 0.15, salaryWeight: 0.1, seniorityNote: null });
  });

  it('shifts weight toward experience for a senior posting', async () => {
    const res = await request(app)
      .post('/internal/compute-seniority-weights')
      .send({ job: { min_experience: 10, experience_years: null } });
    expect(res.status).toBe(200);
    expect(res.body.weights.experienceWeight).toBeGreaterThan(0.35);
    expect(res.body.weights.seniorityNote).toBeTruthy();
  });
});

describe('POST /internal/compute-dynamic-skill-score', () => {
  it('scores an exact match at 100', async () => {
    const res = await request(app)
      .post('/internal/compute-dynamic-skill-score')
      .send({ candidateSkills: ['Python'], tiers: { mandatory: ['Python'], preferred: [], optional: [], bonus: [], roleMatch: null } });
    expect(res.status).toBe(200);
    expect(res.body.result.score).toBe(100);
    expect(res.body.result.matched[0].matchType).toBe('exact');
  });

  it('gives partial credit for a graph-related match', async () => {
    const res = await request(app)
      .post('/internal/compute-dynamic-skill-score')
      .send({ candidateSkills: ['Python'], tiers: { mandatory: ['Django'], preferred: [], optional: [], bonus: [], roleMatch: null } });
    expect(res.status).toBe(200);
    expect(res.body.result.matched[0].matchType).toBe('graph_related');
    expect(res.body.result.score).toBeLessThan(100);
    expect(res.body.result.score).toBeGreaterThan(0);
  });
});

describe('POST /internal/build-explanation', () => {
  it('builds a deterministic, template-based explanation with no LLM call', async () => {
    const res = await request(app)
      .post('/internal/build-explanation')
      .send({
        skillResult: { score: 100, matched: [{ requiredSkill: 'Python', tier: 'mandatory', matchType: 'exact', matchedCandidateSkill: 'Python' }], missingMandatory: [], missingOther: [] },
        weights: { skillWeight: 0.4, experienceWeight: 0.35, locationWeight: 0.15, salaryWeight: 0.1, seniorityNote: null },
      });
    expect(res.status).toBe(200);
    expect(res.body.explanation.reasoning).toContain('Matched 1 of 1');
  });
});

describe('POST /internal/hybrid-retrieve', () => {
  it('fuses structured, semantic, and graph-expanded rankings', async () => {
    const res = await request(app)
      .post('/internal/hybrid-retrieve')
      .send({
        job: { id: 1, required_skills: ['Python'], skills_embedding: null },
        candidates: [
          { id: 101, skills: ['Python'], skills_embedding: null },
          { id: 102, skills: ['Django'], skills_embedding: null },
          { id: 103, skills: ['Rust'], skills_embedding: null },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(3);
    expect(res.body.results[0].candidate.id).toBe(101);
  });
});
