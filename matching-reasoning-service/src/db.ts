/**
 * PostgreSQL connection pool and data-access functions for Matching Reasoning Service's own
 * database (Batch 26) - a dual-written mirror of skill_nodes/skill_edges (the monolith remains the
 * sole writer - skillIntelligence.ts's seeding, unknownSkillDiscovery.ts's promotion pipeline; the
 * upsert/patch functions below exist only because they are dual-write's TARGETS, never called by
 * this service's own reasoning logic) plus this service's own reasoning_conclusions table (written
 * directly by this service's ported computeReasoning.ts, never dual-written).
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { SkillNode, SkillEdge, SkillRelationshipType, ConclusionSubjectType, DraftConclusion, ReasoningConclusion } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_reasoning',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-reasoning-service PostgreSQL pool error:', err);
});

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

// ==================== skill_nodes / skill_edges (dual-write targets, read by this service's own reasoning logic) ====================

// NUMERIC columns come back from node-postgres as strings, not numbers - same coercion the
// monolith's own db.ts applies at its query boundaries.
function coerceSkillNodeRow(row: any): SkillNode {
  return { ...row, popularity_score: Number(row.popularity_score), confidence: Number(row.confidence) };
}

function coerceSkillEdgeRow(row: any): SkillEdge {
  return { ...row, weight: Number(row.weight) };
}

export async function upsertSkillNode(node: {
  id: number;
  canonical_name: string;
  category: string;
  technology_domain: string | null;
  aliases: string[];
  popularity_score: number;
  confidence: number;
  is_deprecated: boolean;
  is_emerging: boolean;
  source: string;
  embedding: number[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO skill_nodes (
         id, canonical_name, category, technology_domain, aliases, popularity_score, confidence,
         is_deprecated, is_emerging, source, embedding, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         canonical_name = EXCLUDED.canonical_name, category = EXCLUDED.category,
         technology_domain = EXCLUDED.technology_domain, aliases = EXCLUDED.aliases,
         popularity_score = EXCLUDED.popularity_score, confidence = EXCLUDED.confidence,
         is_deprecated = EXCLUDED.is_deprecated, is_emerging = EXCLUDED.is_emerging,
         source = EXCLUDED.source, embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at`,
      [
        node.id, node.canonical_name, node.category, node.technology_domain, node.aliases,
        node.popularity_score, node.confidence, node.is_deprecated, node.is_emerging, node.source,
        node.embedding, node.created_at, node.updated_at,
      ]
    );
  } catch (error) {
    console.error('Error upserting skill node (dual-write):', error);
  }
}

export async function upsertSkillEdge(edge: {
  id: number;
  from_skill_id: number;
  to_skill_id: number;
  relationship_type: SkillRelationshipType;
  weight: number;
  source: string;
  created_at: Date | string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO skill_edges (id, from_skill_id, to_skill_id, relationship_type, weight, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         from_skill_id = EXCLUDED.from_skill_id, to_skill_id = EXCLUDED.to_skill_id,
         relationship_type = EXCLUDED.relationship_type, weight = EXCLUDED.weight, source = EXCLUDED.source`,
      [edge.id, edge.from_skill_id, edge.to_skill_id, edge.relationship_type, edge.weight, edge.source, edge.created_at]
    );
  } catch (error) {
    console.error('Error upserting skill edge (dual-write):', error);
  }
}

export async function patchSkillNode(id: number, fields: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  try {
    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await pool.query(`UPDATE skill_nodes SET ${setClause} WHERE id = $${columns.length + 1}`, [...columns.map((c) => fields[c]), id]);
  } catch (error) {
    console.error('Error patching skill node (dual-write):', error);
  }
}

export async function findSkillNodeByAlias(rawText: string): Promise<SkillNode | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM skill_nodes
       WHERE lower(canonical_name) = lower($1)
          OR EXISTS (SELECT 1 FROM unnest(aliases) AS a WHERE lower(a) = lower($1))
       LIMIT 1`,
      [rawText.trim()]
    );
    return result.rows[0] ? coerceSkillNodeRow(result.rows[0]) : null;
  } catch (error) {
    console.error('Error resolving skill alias:', error);
    return null;
  }
}

export async function getSkillNodeById(id: number): Promise<SkillNode | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes WHERE id = $1', [id]);
    return result.rows[0] ? coerceSkillNodeRow(result.rows[0]) : null;
  } catch (error) {
    console.error('Error fetching skill node by id:', error);
    return null;
  }
}

export async function getAllSkillNodes(): Promise<SkillNode[]> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes ORDER BY canonical_name');
    return result.rows.map(coerceSkillNodeRow);
  } catch (error) {
    console.error('Error fetching all skill nodes:', error);
    return [];
  }
}

export async function getSkillEdgesFrom(skillId: number, relationshipType?: SkillRelationshipType): Promise<SkillEdge[]> {
  try {
    const result = relationshipType
      ? await pool.query('SELECT * FROM skill_edges WHERE from_skill_id = $1 AND relationship_type = $2', [skillId, relationshipType])
      : await pool.query('SELECT * FROM skill_edges WHERE from_skill_id = $1', [skillId]);
    return result.rows.map(coerceSkillEdgeRow);
  } catch (error) {
    console.error('Error fetching skill edges:', error);
    return [];
  }
}

export async function getSkillEdgesTo(skillId: number, relationshipType?: SkillRelationshipType): Promise<SkillEdge[]> {
  try {
    const result = relationshipType
      ? await pool.query('SELECT * FROM skill_edges WHERE to_skill_id = $1 AND relationship_type = $2', [skillId, relationshipType])
      : await pool.query('SELECT * FROM skill_edges WHERE to_skill_id = $1', [skillId]);
    return result.rows.map(coerceSkillEdgeRow);
  } catch (error) {
    console.error('Error fetching skill edges:', error);
    return [];
  }
}

// ==================== reasoning_conclusions (owned + written directly by this service) ====================

function coerceReasoningConclusionRow(row: any): ReasoningConclusion {
  return { ...row, conclusion_confidence: Number(row.conclusion_confidence) };
}

export async function replaceReasoningConclusions(
  subjectType: ConclusionSubjectType,
  subjectId: number,
  conclusions: DraftConclusion[]
): Promise<ReasoningConclusion[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);

    const inserted: ReasoningConclusion[] = [];
    for (const c of conclusions) {
      const result = await client.query(
        `INSERT INTO reasoning_conclusions (
           subject_type, subject_id, conclusion_text, conclusion_type, reasoning_type,
           evidence_chain, conclusion_confidence, confidence_derivation, derived_from
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          subjectType, subjectId, c.conclusion_text, c.conclusion_type, c.reasoning_type,
          JSON.stringify(c.evidence_chain), c.conclusion_confidence, c.confidence_derivation, c.derived_from,
        ]
      );
      inserted.push(coerceReasoningConclusionRow(result.rows[0]));
    }

    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error replacing reasoning conclusions:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getReasoningConclusions(subjectType: ConclusionSubjectType, subjectId: number): Promise<ReasoningConclusion[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM reasoning_conclusions WHERE subject_type = $1 AND subject_id = $2 ORDER BY conclusion_confidence DESC',
      [subjectType, subjectId]
    );
    return result.rows.map(coerceReasoningConclusionRow);
  } catch (error) {
    console.error('Error fetching reasoning conclusions:', error);
    return [];
  }
}

// ==================== career_trajectories (Phase D Item 3, owned write path) ====================

export async function getCareerTrajectory(candidateId: number): Promise<any> {
  try {
    const result = await pool.query(
      'SELECT * FROM career_trajectories WHERE candidate_id = $1',
      [candidateId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching career trajectory:', error);
    return null;
  }
}

export async function replaceCareerTrajectory(candidateId: number, trajectory: any): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing trajectory for this candidate
    await client.query('DELETE FROM career_trajectories WHERE candidate_id = $1', [candidateId]);

    // Insert new trajectory
    const result = await client.query(
      `INSERT INTO career_trajectories (
         candidate_id, company_id, job_sequence, total_career_months, role_count,
         progression_type, seniority_level, seniority_trend, transitions,
         avg_tenure_months, median_tenure_months, tenure_pattern, gaps,
         domain_concentration, domains, trajectory_embedding, predicted_next_roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        candidateId,
        trajectory.company_id,
        JSON.stringify(trajectory.job_sequence),
        trajectory.total_career_months,
        trajectory.role_count,
        trajectory.progression_type,
        trajectory.seniority_level,
        trajectory.seniority_trend,
        trajectory.transitions ? JSON.stringify(trajectory.transitions) : null,
        trajectory.avg_tenure_months,
        trajectory.median_tenure_months,
        trajectory.tenure_pattern,
        trajectory.gaps ? JSON.stringify(trajectory.gaps) : null,
        trajectory.domain_concentration,
        trajectory.domains ? JSON.stringify(trajectory.domains) : null,
        trajectory.trajectory_embedding,
        trajectory.predicted_next_roles ? JSON.stringify(trajectory.predicted_next_roles) : null,
      ]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error replacing career trajectory:', error);
    return null;
  } finally {
    client.release();
  }
}

export const db = {
  healthCheck,
  upsertSkillNode,
  upsertSkillEdge,
  patchSkillNode,
  findSkillNodeByAlias,
  getSkillNodeById,
  getAllSkillNodes,
  getSkillEdgesFrom,
  getSkillEdgesTo,
  replaceReasoningConclusions,
  getReasoningConclusions,
  getCareerTrajectory,
  replaceCareerTrajectory,
};

export { pool };
