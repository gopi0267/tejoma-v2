/**
 * Integration tests for src/api/skill-discovery-internal.routes.ts (Batch 27) - real HTTP against
 * a minimal standalone Express app mounting only this router, against the real database. Mirrors
 * tests/matching-evaluation-internal.routes.test.ts's approach exactly (see its header comment for
 * why).
 */
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pkg from 'pg';
import skillDiscoveryInternalRoutes from '../src/api/skill-discovery-internal.routes.js';

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
app.use('/internal/skill-discovery', skillDiscoveryInternalRoutes);

afterAll(async () => {
  await pool.query("DELETE FROM skill_edges WHERE source = 'unknown_skill_discovery' AND (SELECT canonical_name FROM skill_nodes WHERE id = from_skill_id) LIKE 'Batch27Internal%'");
  await pool.query("DELETE FROM skill_nodes WHERE canonical_name LIKE 'Batch27Internal%'");
  await pool.end();
});

describe('POST /internal/skill-discovery/promote', () => {
  it('requires rawToken and confidence', async () => {
    const res = await request(app).post('/internal/skill-discovery/promote').send({});
    expect(res.status).toBe(400);
  });

  it('creates a real skill_nodes row via the unchanged db.upsertSkillNode', async () => {
    const res = await request(app)
      .post('/internal/skill-discovery/promote')
      .send({ rawToken: 'Batch27InternalTool', proposedCategory: 'tool', confidence: 0.8, relationshipType: null, relatedSkillId: null });

    expect(res.status).toBe(200);
    expect(res.body.skill_node.canonical_name).toBe('Batch27InternalTool');
    expect(res.body.skill_node.category).toBe('tool');
    expect(res.body.skill_node.technology_domain).toBe('Developer Tooling');
    expect(res.body.skill_node.is_emerging).toBe(true);
    expect(res.body.skill_node.source).toBe('unknown_skill_discovery');

    const stored = await pool.query('SELECT * FROM skill_nodes WHERE canonical_name = $1', ['Batch27InternalTool']);
    expect(stored.rows).toHaveLength(1);
  });

  it('creates the bidirectional RELATED_TO edge when a related skill id is provided', async () => {
    const related = await pool.query(
      `INSERT INTO skill_nodes (canonical_name, category, aliases) VALUES ('Batch27InternalRelated', 'tool', '{}') RETURNING id`
    );
    const relatedId = related.rows[0].id;

    const res = await request(app)
      .post('/internal/skill-discovery/promote')
      .send({ rawToken: 'Batch27InternalWithEdge', proposedCategory: 'tool', confidence: 0.9, relationshipType: 'RELATED_TO', relatedSkillId: relatedId });

    expect(res.status).toBe(200);
    const newNodeId = res.body.skill_node.id;

    const edges = await pool.query(
      'SELECT * FROM skill_edges WHERE (from_skill_id = $1 AND to_skill_id = $2) OR (from_skill_id = $2 AND to_skill_id = $1)',
      [newNodeId, relatedId]
    );
    expect(edges.rows).toHaveLength(2);

    await pool.query('DELETE FROM skill_edges WHERE from_skill_id = $1 OR to_skill_id = $1', [relatedId]);
    await pool.query('DELETE FROM skill_nodes WHERE id = $1', [relatedId]);
  });
});
