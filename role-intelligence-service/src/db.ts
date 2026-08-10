/**
 * PostgreSQL connection pool and data-access functions for Role Intelligence Service's own
 * database (Batch 29) - a dual-written, read-only-from-this-service's-own-code mirror of
 * role_profiles. The monolith remains the sole writer (scripts/seed-intelligence-layer.ts's
 * unchanged seedRoleProfiles()) - upsertRoleProfile/patchRoleProfile here exist only as
 * dual-write's targets, never called by this service's own read-only logic.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention,
 * including the monolith's own lack of NUMERIC coercion on experience_band_min/max - preserved
 * exactly, not "fixed", per this batch's preserve-existing-behavior rule).
 */
import pkg from 'pg';
import type { RoleProfile } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_role_intelligence',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('role-intelligence-service PostgreSQL pool error:', err);
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

export async function getRoleProfileByKey(roleKey: string): Promise<RoleProfile | null> {
  try {
    const result = await pool.query('SELECT * FROM role_profiles WHERE role_key = $1', [roleKey]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching role profile:', error);
    return null;
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

export const db = { healthCheck, upsertRoleProfile, patchRoleProfile, getRoleProfileByKey, getAllRoleProfiles };

export { pool };
