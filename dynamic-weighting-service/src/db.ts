/**
 * PostgreSQL connection pool and data-access functions for Dynamic Weighting / Explainable
 * Matching Service's own database (Batch 33) - dual-written, read-only-from-this-service's-own-
 * code mirrors of skill_nodes, skill_edges, and role_profiles. The monolith remains the sole
 * writer of all three - upsert/patch functions here exist only as dual-write's targets, never
 * called by this service's own read-only ported logic (resolveSkillTiers,
 * computeDynamicSkillScore, hybridRetrieveCandidates).
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { RoleProfile, SkillNode, SkillEdge, SkillRelationshipType } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_dynamic_weighting',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('dynamic-weighting-service PostgreSQL pool error:', err);
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

// ==================== skill_nodes / skill_edges (dual-write targets, read by this service's own logic) ====================

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

// ==================== role_profiles (dual-write target, read by this service's own logic) ====================

export async function upsertRoleProfile(row: {
  id: number;
  role_key: string;
  display_name: string;
  mandatory_skills: string[];
  preferred_skills: string[];
  optional_skills: string[];
  common_tools: string[];
  typical_responsibilities: string[];
  preferred_certifications: string[];
  experience_band_min: number | null;
  experience_band_max: number | null;
  related_roles: string[];
  career_progression: string[];
  embedding: number[] | null;
  source: string;
  created_at: string | Date;
  updated_at: string | Date;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO role_profiles (
         id, role_key, display_name, mandatory_skills, preferred_skills, optional_skills,
         common_tools, typical_responsibilities, preferred_certifications, experience_band_min,
         experience_band_max, related_roles, career_progression, embedding, source, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         role_key = EXCLUDED.role_key, display_name = EXCLUDED.display_name,
         mandatory_skills = EXCLUDED.mandatory_skills, preferred_skills = EXCLUDED.preferred_skills,
         optional_skills = EXCLUDED.optional_skills, common_tools = EXCLUDED.common_tools,
         typical_responsibilities = EXCLUDED.typical_responsibilities,
         preferred_certifications = EXCLUDED.preferred_certifications,
         experience_band_min = EXCLUDED.experience_band_min, experience_band_max = EXCLUDED.experience_band_max,
         related_roles = EXCLUDED.related_roles, career_progression = EXCLUDED.career_progression,
         embedding = EXCLUDED.embedding, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
      [
        row.id, row.role_key, row.display_name, row.mandatory_skills, row.preferred_skills,
        row.optional_skills, row.common_tools, row.typical_responsibilities, row.preferred_certifications,
        row.experience_band_min, row.experience_band_max, row.related_roles, row.career_progression,
        row.embedding, row.source, row.created_at, row.updated_at,
      ]
    );
  } catch (error) {
    console.error('Error upserting role profile (dual-write):', error);
  }
}

export async function patchRoleProfile(id: number, fields: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(fields);
  if (columns.length === 0) return;
  try {
    const setClause = columns.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await pool.query(`UPDATE role_profiles SET ${setClause} WHERE id = $${columns.length + 1}`, [...columns.map((c) => fields[c]), id]);
  } catch (error) {
    console.error('Error patching role profile (dual-write):', error);
  }
}

export async function getAllRoleProfiles(): Promise<RoleProfile[]> {
  try {
    const result = await pool.query('SELECT * FROM role_profiles ORDER BY display_name');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all role profiles:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  upsertSkillNode,
  patchSkillNode,
  upsertSkillEdge,
  findSkillNodeByAlias,
  getSkillNodeById,
  getSkillEdgesFrom,
  upsertRoleProfile,
  patchRoleProfile,
  getAllRoleProfiles,
};

export { pool };
