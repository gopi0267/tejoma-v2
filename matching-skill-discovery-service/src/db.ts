/**
 * PostgreSQL connection pool and data-access functions for Matching Skill Discovery Service's own
 * database (Batch 27) - skill_discovery_proposals (owned, written directly by this service's own
 * ported pipeline) plus a dual-written, read-only-from-this-service's-own-code mirror of
 * skill_nodes (the monolith remains the sole writer - skillIntelligence.ts's seeding,
 * unknownSkillDiscovery.ts's own promotion pipeline there; upsertSkillNode/patchSkillNode here
 * exist only because they are dual-write's targets, never called by this service's own discovery
 * logic, exactly like matching-reasoning-service's copy).
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention,
 * including the monolith's own lack of NUMERIC coercion on skill_discovery_proposals.confidence -
 * preserved exactly, not "fixed", per this batch's preserve-existing-behavior rule).
 */
import pkg from 'pg';
import type { SkillNode, SkillDiscoveryProposal, SkillDiscoveryStatus, SkillRelationshipType } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_skill_discovery',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-skill-discovery-service PostgreSQL pool error:', err);
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

// ==================== skill_nodes (dual-write target, read by this service's own discovery logic) ====================

function coerceSkillNodeRow(row: any): SkillNode {
  return { ...row, popularity_score: Number(row.popularity_score), confidence: Number(row.confidence) };
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

export async function getAllSkillNodes(): Promise<SkillNode[]> {
  try {
    const result = await pool.query('SELECT * FROM skill_nodes ORDER BY canonical_name');
    return result.rows.map(coerceSkillNodeRow);
  } catch (error) {
    console.error('Error fetching all skill nodes:', error);
    return [];
  }
}

// ==================== skill_discovery_proposals (owned + written directly by this service) ====================
// No NUMERIC coercion on `confidence` here - the monolith's own db.ts never coerces it either
// (returns the raw pg string), preserved exactly rather than "fixed", per this batch's
// preserve-existing-behavior rule.

export async function getSkillDiscoveryProposalByToken(normalizedToken: string): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_discovery_proposals WHERE normalized_token = $1', [normalizedToken]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill discovery proposal by token:', error);
    return null;
  }
}

export async function getSkillDiscoveryProposalById(id: number): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query('SELECT * FROM skill_discovery_proposals WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching skill discovery proposal by id:', error);
    return null;
  }
}

export async function createSkillDiscoveryProposal(input: {
  raw_token: string;
  normalized_token: string;
  source_type: 'resume' | 'jd';
  context_text: string | null;
  is_skill: boolean | null;
  proposed_category: string | null;
  nearest_neighbors: SkillDiscoveryProposal['nearest_neighbors'];
  proposed_relationship_type: SkillRelationshipType | null;
  proposed_related_skill_id: number | null;
  confidence: number | null;
  status: SkillDiscoveryStatus;
}): Promise<SkillDiscoveryProposal | null> {
  try {
    const result = await pool.query(
      `INSERT INTO skill_discovery_proposals (
         raw_token, normalized_token, source_type, context_text,
         is_skill, proposed_category, nearest_neighbors, proposed_relationship_type,
         proposed_related_skill_id, confidence, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (normalized_token) DO NOTHING
       RETURNING *`,
      [
        input.raw_token, input.normalized_token, input.source_type, input.context_text,
        input.is_skill, input.proposed_category, JSON.stringify(input.nearest_neighbors ?? []), input.proposed_relationship_type,
        input.proposed_related_skill_id, input.confidence, input.status,
      ]
    );
    return result.rows[0] || (await getSkillDiscoveryProposalByToken(input.normalized_token));
  } catch (error) {
    console.error('Error creating skill discovery proposal:', error);
    return null;
  }
}

export async function updateSkillDiscoveryProposal(id: number, updates: Partial<SkillDiscoveryProposal>): Promise<SkillDiscoveryProposal | null> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'id') {
        fields.push(`${key} = $${paramIndex}`);
        values.push(key === 'nearest_neighbors' ? JSON.stringify(value ?? []) : value);
        paramIndex++;
      }
    }

    if (fields.length === 0) return getSkillDiscoveryProposalById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE skill_discovery_proposals SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error updating skill discovery proposal:', error);
    return null;
  }
}

export async function getPendingSkillDiscoveryProposals(limit: number = 50): Promise<SkillDiscoveryProposal[]> {
  try {
    const result = await pool.query(
      "SELECT * FROM skill_discovery_proposals WHERE status = 'pending' ORDER BY mention_count DESC, created_at ASC LIMIT $1",
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching pending skill discovery proposals:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  upsertSkillNode,
  patchSkillNode,
  findSkillNodeByAlias,
  getAllSkillNodes,
  getSkillDiscoveryProposalByToken,
  getSkillDiscoveryProposalById,
  createSkillDiscoveryProposal,
  updateSkillDiscoveryProposal,
  getPendingSkillDiscoveryProposals,
};

export { pool };
