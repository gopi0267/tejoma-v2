/**
 * Integration tests for POST /internal/compute-for-candidate and POST /internal/compute-for-job -
 * real HTTP against a real database, seeded directly with skill_nodes/skill_edges rows (standing
 * in for dual-write having already mirrored them from the monolith - see dualWrite.ts's
 * upsertSkillNode/upsertSkillEdge, the real writer this data would come from in production).
 *
 * Seed graph: a "Web Development" domain node PARENT_OF React/Vue.js/Angular, each RELATED_TO the
 * other two (skillIntelligence.ts's RELATED_TO_GROUPS convention) - enough to exercise all three
 * of concept/hierarchical/technology-relationship reasoning with real, non-trivial output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { pool, db } from '../src/db.js';

let webDevId: number;
let reactId: number;
let vueId: number;
let angularId: number;

beforeAll(async () => {
  const insertNode = async (canonical_name: string, category: string) => {
    const result = await pool.query(
      `INSERT INTO skill_nodes (canonical_name, category, aliases) VALUES ($1, $2, '{}') RETURNING id`,
      [canonical_name, category]
    );
    return result.rows[0].id;
  };

  webDevId = await insertNode('Web Development', 'domain');
  reactId = await insertNode('React', 'frontend_framework');
  vueId = await insertNode('Vue.js', 'frontend_framework');
  angularId = await insertNode('Angular', 'frontend_framework');

  const insertEdge = async (from: number, to: number, type: string) => {
    await pool.query(
      `INSERT INTO skill_edges (from_skill_id, to_skill_id, relationship_type) VALUES ($1, $2, $3)`,
      [from, to, type]
    );
  };

  await insertEdge(webDevId, reactId, 'PARENT_OF');
  await insertEdge(webDevId, vueId, 'PARENT_OF');
  await insertEdge(webDevId, angularId, 'PARENT_OF');
  await insertEdge(reactId, vueId, 'RELATED_TO');
  await insertEdge(vueId, reactId, 'RELATED_TO');
  await insertEdge(reactId, angularId, 'RELATED_TO');
  await insertEdge(angularId, reactId, 'RELATED_TO');
});

afterAll(async () => {
  await pool.query('DELETE FROM reasoning_conclusions WHERE subject_id IN (9001, 9002)');
  await pool.query('DELETE FROM skill_edges WHERE from_skill_id = ANY($1) OR to_skill_id = ANY($1)', [[webDevId, reactId, vueId, angularId]]);
  await pool.query('DELETE FROM skill_nodes WHERE id = ANY($1)', [[webDevId, reactId, vueId, angularId]]);
  await pool.end();
});

describe('POST /internal/compute-for-candidate', () => {
  it('requires candidateId', async () => {
    const res = await request(app).post('/internal/compute-for-candidate').send({});
    expect(res.status).toBe(400);
  });

  it('computes real concept/hierarchical/technology-relationship conclusions from the seeded skill graph and stores them', async () => {
    const res = await request(app)
      .post('/internal/compute-for-candidate')
      .send({ candidateId: 9001, skills: ['React', 'Vue.js', 'Angular'], projectEntries: [] });

    expect(res.status).toBe(200);
    const conclusions = res.body.conclusions;

    const concept = conclusions.find((c: any) => c.reasoning_type === 'concept');
    expect(concept).toBeTruthy();
    expect(concept.conclusion_text).toContain('Web Development');

    const hierarchical = conclusions.filter((c: any) => c.reasoning_type === 'hierarchical');
    expect(hierarchical).toHaveLength(3);

    const coherence = conclusions.find((c: any) => c.reasoning_type === 'technology_relationship');
    expect(coherence).toBeTruthy();
    expect(coherence.conclusion_text).toContain('coherence score');

    // Persisted, not just echoed in the response - read back independently via db.ts.
    const stored = await db.getReasoningConclusions('candidate', 9001);
    expect(stored.length).toBe(conclusions.length);
  });

  it('replaces the previous conclusion set on a second call for the same candidate (no accumulation)', async () => {
    await request(app).post('/internal/compute-for-candidate').send({ candidateId: 9001, skills: ['React', 'Vue.js', 'Angular'], projectEntries: [] });
    const stored = await db.getReasoningConclusions('candidate', 9001);
    const concept = stored.filter((c) => c.reasoning_type === 'concept');
    expect(concept).toHaveLength(1);
  });
});

describe('POST /internal/compute-for-job', () => {
  it('requires jobId', async () => {
    const res = await request(app).post('/internal/compute-for-job').send({});
    expect(res.status).toBe(400);
  });

  it('computes reasoning over required+optional skills (no causal reasoning for jobs)', async () => {
    const res = await request(app)
      .post('/internal/compute-for-job')
      .send({ jobId: 9002, requiredSkills: ['React', 'Vue.js'], optionalSkills: ['Angular'] });

    expect(res.status).toBe(200);
    const conclusions = res.body.conclusions;
    expect(conclusions.some((c: any) => c.reasoning_type === 'causal')).toBe(false);
    expect(conclusions.some((c: any) => c.reasoning_type === 'hierarchical')).toBe(true);
  });
});
