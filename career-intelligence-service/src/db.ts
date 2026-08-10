/**
 * PostgreSQL connection pool and data-access functions for Career Intelligence Service's own
 * database (Batch 30) - TWO different ownership shapes in one pool, per this service's own
 * migration header comment:
 *
 *   - role_profiles: a THIRD independent dual-written mirror (alongside Role Intelligence
 *     Service's own from Batch 29, and Reasoning/Skill-Discovery's skill_nodes-style mirrors from
 *     Batches 26/27). The monolith remains the sole writer - upsertRoleProfile/patchRoleProfile
 *     below exist only as dual-write's targets, never called by this service's own read-only
 *     logic (findLexicalRoleMatch, predictNextRoles).
 *   - career_trajectories: owned and written DIRECTLY by this service's own ported
 *     computeCareerTrajectory pipeline, independent of (not a mirror of) the monolith's own copy
 *     of the same table - same "independent computation, shadow-validated" shape as Batch 26's
 *     reasoning_conclusions and Batch 27's skill_discovery_proposals.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention).
 */
import pkg from 'pg';
import type { CareerTrajectory, NormalizedJob, ProgressionType, SeniorityLevel, SeniorityTrend, TenurePattern, CareerTransition, EmploymentGap, DomainBreakdown, PredictedRole, RoleProfile } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_career_intelligence',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('career-intelligence-service PostgreSQL pool error:', err);
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

// ==================== role_profiles (dual-write target, read by this service's own pipeline) ====================

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

// ==================== career_trajectories (owned + written directly by this service) ====================

export async function upsertCareerTrajectory(input: {
  candidate_id: number;
  company_id: number;
  job_sequence: NormalizedJob[];
  total_career_months: number | null;
  role_count: number | null;
  progression_type: ProgressionType | null;
  seniority_level: SeniorityLevel | null;
  seniority_trend: SeniorityTrend | null;
  transitions: CareerTransition[];
  avg_tenure_months: number | null;
  median_tenure_months: number | null;
  tenure_pattern: TenurePattern | null;
  gaps: EmploymentGap[];
  domain_concentration: number | null;
  domains: DomainBreakdown[];
  trajectory_embedding: number[];
  predicted_next_roles: PredictedRole[];
}): Promise<CareerTrajectory | null> {
  try {
    const result = await pool.query(
      `INSERT INTO career_trajectories (
         candidate_id, company_id, job_sequence, total_career_months, role_count,
         progression_type, seniority_level, seniority_trend, transitions,
         avg_tenure_months, median_tenure_months, tenure_pattern, gaps,
         domain_concentration, domains, trajectory_embedding, predicted_next_roles
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (candidate_id) DO UPDATE SET
         job_sequence = EXCLUDED.job_sequence, total_career_months = EXCLUDED.total_career_months,
         role_count = EXCLUDED.role_count, progression_type = EXCLUDED.progression_type,
         seniority_level = EXCLUDED.seniority_level, seniority_trend = EXCLUDED.seniority_trend,
         transitions = EXCLUDED.transitions, avg_tenure_months = EXCLUDED.avg_tenure_months,
         median_tenure_months = EXCLUDED.median_tenure_months, tenure_pattern = EXCLUDED.tenure_pattern,
         gaps = EXCLUDED.gaps, domain_concentration = EXCLUDED.domain_concentration,
         domains = EXCLUDED.domains, trajectory_embedding = EXCLUDED.trajectory_embedding,
         predicted_next_roles = EXCLUDED.predicted_next_roles, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        input.candidate_id, input.company_id, JSON.stringify(input.job_sequence), input.total_career_months, input.role_count,
        input.progression_type, input.seniority_level, input.seniority_trend, JSON.stringify(input.transitions),
        input.avg_tenure_months, input.median_tenure_months, input.tenure_pattern, JSON.stringify(input.gaps),
        input.domain_concentration, JSON.stringify(input.domains), input.trajectory_embedding, JSON.stringify(input.predicted_next_roles),
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error upserting career trajectory:', error);
    return null;
  }
}

export async function getCareerTrajectory(candidateId: number, companyId: number): Promise<CareerTrajectory | null> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE candidate_id = $1 AND company_id = $2', [candidateId, companyId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching career trajectory:', error);
    return null;
  }
}

export async function getAllCareerTrajectoriesForCompany(companyId: number): Promise<CareerTrajectory[]> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE company_id = $1', [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all career trajectories for company:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  upsertRoleProfile,
  patchRoleProfile,
  getAllRoleProfiles,
  upsertCareerTrajectory,
  getCareerTrajectory,
  getAllCareerTrajectoriesForCompany,
};

export { pool };
