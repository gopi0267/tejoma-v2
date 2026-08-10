/**
 * PostgreSQL connection pool and data-access functions for Matching Evaluation Service's own
 * database - match_evaluation_runs/ltr_model_versions (Batch 24) and proficiency_shadow_scores
 * (Batch 25), moved out of the monolith's shared database.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention) with
 * one adjustment: cross-service FKs are dropped here (each migration's own header comment
 * explains why). No dual-write back to the monolith from here - this service's own routes only
 * ever read/write its own database, exactly like every other Tier 0 service. Unlike Batch 24's two
 * tables, proficiency_shadow_scores is READ-ONLY from this service's own code - it's populated
 * entirely by dual-write from the monolith's unchanged shadowScoring.ts, so there is no
 * insert/save function for it here, only a read.
 */
import pkg from 'pg';
import type { LtrModelVersion, MatchEvaluationRun, ProficiencyShadowScore, RoleProfile, SkillNode, CareerTrajectory, ReasoningConclusion, ConclusionSubjectType } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_evaluation',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-evaluation-service PostgreSQL pool error:', err);
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

// ==================== ltr_model_versions ====================

export async function saveLtrModelVersion(version: Omit<LtrModelVersion, 'id' | 'trained_at'>): Promise<LtrModelVersion | null> {
  try {
    const result = await pool.query(
      `INSERT INTO ltr_model_versions (version, algorithm, training_examples, training_groups, ndcg_at_10, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [version.version, version.algorithm, version.training_examples, version.training_groups, version.ndcg_at_10, version.is_active]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving LTR model version:', error);
    return null;
  }
}

export async function getLatestLtrModelVersion(): Promise<LtrModelVersion | null> {
  try {
    const result = await pool.query('SELECT * FROM ltr_model_versions ORDER BY trained_at DESC LIMIT 1');
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching latest LTR model version:', error);
    return null;
  }
}

// ==================== match_evaluation_runs ====================

export async function saveEvaluationRun(run: Omit<MatchEvaluationRun, 'id' | 'evaluated_at'>): Promise<MatchEvaluationRun | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_evaluation_runs (
         company_id, jobs_evaluated, swipes_evaluated, k, ndcg_at_k, map_at_k, mrr, precision_at_k, recall_at_k, data_volume_note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [run.company_id, run.jobs_evaluated, run.swipes_evaluated, run.k, run.ndcg_at_k, run.map_at_k, run.mrr, run.precision_at_k, run.recall_at_k, run.data_volume_note]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving evaluation run:', error);
    return null;
  }
}

export async function getEvaluationRuns(companyId: number, limit: number = 20): Promise<MatchEvaluationRun[]> {
  try {
    const result = await pool.query(
      'SELECT * FROM match_evaluation_runs WHERE company_id = $1 ORDER BY evaluated_at DESC LIMIT $2',
      [companyId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching evaluation runs:', error);
    return [];
  }
}

// ==================== proficiency_shadow_scores (Batch 25, read-only) ====================
// NUMERIC columns come back from node-postgres as strings, not numbers - same coercion the
// monolith's own coerceProficiencyShadowScoreRow applies, needed here since
// shadowDataHealth.ts/proficiencyAnalytics.ts do real numeric comparisons on these fields.

function coerceProficiencyShadowScoreRow(row: any): ProficiencyShadowScore {
  const n = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    base_match_score: Number(row.base_match_score),
    proficiency_adjusted_score: Number(row.proficiency_adjusted_score),
    overall_multiplier: Number(row.overall_multiplier),
    decision_action: n(row.decision_action),
    career_multiplier: n(row.career_multiplier),
    career_progression_signal: n(row.career_progression_signal),
    career_stability_signal: n(row.career_stability_signal),
    career_domain_signal: n(row.career_domain_signal),
    career_adjusted_score: n(row.career_adjusted_score),
    recency_multiplier: n(row.recency_multiplier),
    recency_adjusted_score: n(row.recency_adjusted_score),
    reasoning_multiplier: n(row.reasoning_multiplier),
    reasoning_adjusted_score: n(row.reasoning_adjusted_score),
    reasoning_coverage_signal: n(row.reasoning_coverage_signal),
  };
}

export async function getAllProficiencyShadowScoresForCompany(companyId: number): Promise<ProficiencyShadowScore[]> {
  try {
    const result = await pool.query('SELECT * FROM proficiency_shadow_scores WHERE company_id = $1 ORDER BY computed_at DESC', [companyId]);
    return result.rows.map(coerceProficiencyShadowScoreRow);
  } catch (error) {
    console.error('Error fetching all proficiency shadow scores for company:', error);
    return [];
  }
}

// ==================== skill_nodes (Batch 31, THIRD independent dual-write mirror, read-only) ====================

function coerceSkillNodeRow(row: any): SkillNode {
  return { ...row, popularity_score: Number(row.popularity_score), confidence: Number(row.confidence) };
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

// ==================== role_profiles (Batch 31, THIRD independent dual-write mirror, read-only) ====================

export async function getAllRoleProfiles(): Promise<RoleProfile[]> {
  try {
    const result = await pool.query('SELECT * FROM role_profiles ORDER BY display_name');
    return result.rows;
  } catch (error) {
    console.error('Error fetching all role profiles:', error);
    return [];
  }
}

// ==================== career_trajectories (Batch 31, first PASSIVE dual-write mirror, read-only) ====================
// Unlike career-intelligence-service's own independently-computed copy (Batch 30), this is a
// plain dual-write mirror of the monolith's real, fully-populated table - careerWeighting.ts needs
// the same complete data the monolith's own computeCareerShadowResult reads.

export async function getCareerTrajectory(candidateId: number, companyId: number): Promise<CareerTrajectory | null> {
  try {
    const result = await pool.query('SELECT * FROM career_trajectories WHERE candidate_id = $1 AND company_id = $2', [candidateId, companyId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching career trajectory:', error);
    return null;
  }
}

// ==================== reasoning_conclusions (Batch 31, first PASSIVE dual-write mirror, read-only) ====================
// Unlike matching-reasoning-service's own independently-computed copy (Batch 26), this is a plain
// dual-write mirror (transactional delete+insert per subject) of the monolith's real, complete
// table - reasoningWeighting.ts needs the same complete data the monolith's own
// computeReasoningShadowResult reads.

function coerceReasoningConclusionRow(row: any): ReasoningConclusion {
  return { ...row, conclusion_confidence: Number(row.conclusion_confidence) };
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

// Phase D Item 4: Owned write path (replaces monolith's passive mirror on REASONING_CONCLUSIONS_CUTOVER_ENABLED)
export async function replaceReasoningConclusions(
  subjectType: ConclusionSubjectType,
  subjectId: number,
  conclusions: any[]
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

// ==================== shadow_weighting_computations (Batch 31, owned, written directly by this service) ====================
// This service's OWN independently-computed version of the monolith's shadowScoring.ts orchestrator
// - never merged with proficiency_shadow_scores (the passive mirror of what the monolith actually
// computed). See migrations/003_shadow_cluster.up.sql's header comment for the full reasoning.

// NUMERIC columns come back from node-postgres as strings, not numbers - same coercion
// coerceProficiencyShadowScoreRow already applies above. Needed here specifically because this
// row is returned over HTTP to the monolith's shadow-comparison client
// (matchingEvaluationServiceShadow.ts), which JSON.stringify-compares these fields directly
// against real JS numbers - an uncoerced string would make every real comparison spuriously
// diverge.
function coerceShadowWeightingComputationRow(row: any): any {
  const n = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    ...row,
    base_match_score: Number(row.base_match_score),
    proficiency_adjusted_score: Number(row.proficiency_adjusted_score),
    overall_multiplier: Number(row.overall_multiplier),
    decision_action: n(row.decision_action),
    career_multiplier: n(row.career_multiplier),
    career_progression_signal: n(row.career_progression_signal),
    career_stability_signal: n(row.career_stability_signal),
    career_domain_signal: n(row.career_domain_signal),
    career_adjusted_score: n(row.career_adjusted_score),
    recency_multiplier: n(row.recency_multiplier),
    recency_adjusted_score: n(row.recency_adjusted_score),
    reasoning_multiplier: n(row.reasoning_multiplier),
    reasoning_density_signal: n(row.reasoning_density_signal),
    reasoning_coverage_signal: n(row.reasoning_coverage_signal),
    reasoning_quality_signal: n(row.reasoning_quality_signal),
    reasoning_adjusted_score: n(row.reasoning_adjusted_score),
  };
}

export async function insertShadowWeightingComputation(input: {
  company_id: number;
  candidate_id: number;
  job_id: number;
  base_match_score: number;
  proficiency_adjusted_score: number;
  overall_multiplier: number;
  skill_multipliers: unknown;
  decision_action: number | null;
  career_multiplier: number | null;
  career_progression_signal: number | null;
  career_stability_signal: number | null;
  career_domain_signal: number | null;
  career_adjusted_score: number | null;
  career_progression_type: string | null;
  recency_multiplier: number;
  recency_adjusted_score: number;
  recency_role_expectation: string;
  recency_skill_multipliers: unknown;
  reasoning_multiplier: number;
  reasoning_density_signal: number;
  reasoning_coverage_signal: number;
  reasoning_quality_signal: number;
  reasoning_adjusted_score: number;
  reasoning_covered_domains: unknown;
  reasoning_uncovered_domains: unknown;
}): Promise<any> {
  try {
    const result = await pool.query(
      `INSERT INTO shadow_weighting_computations (
         company_id, candidate_id, job_id, base_match_score, proficiency_adjusted_score,
         overall_multiplier, skill_multipliers, decision_action, career_multiplier,
         career_progression_signal, career_stability_signal, career_domain_signal,
         career_adjusted_score, career_progression_type, recency_multiplier, recency_adjusted_score,
         recency_role_expectation, recency_skill_multipliers, reasoning_multiplier,
         reasoning_density_signal, reasoning_coverage_signal, reasoning_quality_signal,
         reasoning_adjusted_score, reasoning_covered_domains, reasoning_uncovered_domains
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        input.company_id, input.candidate_id, input.job_id, input.base_match_score, input.proficiency_adjusted_score,
        input.overall_multiplier, JSON.stringify(input.skill_multipliers), input.decision_action, input.career_multiplier,
        input.career_progression_signal, input.career_stability_signal, input.career_domain_signal,
        input.career_adjusted_score, input.career_progression_type, input.recency_multiplier, input.recency_adjusted_score,
        input.recency_role_expectation, JSON.stringify(input.recency_skill_multipliers), input.reasoning_multiplier,
        input.reasoning_density_signal, input.reasoning_coverage_signal, input.reasoning_quality_signal,
        input.reasoning_adjusted_score, JSON.stringify(input.reasoning_covered_domains), JSON.stringify(input.reasoning_uncovered_domains),
      ]
    );
    return result.rows[0] ? coerceShadowWeightingComputationRow(result.rows[0]) : null;
  } catch (error) {
    console.error('Error inserting shadow weighting computation:', error);
    return null;
  }
}

export const db = {
  healthCheck,
  saveLtrModelVersion,
  getLatestLtrModelVersion,
  saveEvaluationRun,
  getEvaluationRuns,
  getAllProficiencyShadowScoresForCompany,
  findSkillNodeByAlias,
  getAllRoleProfiles,
  getCareerTrajectory,
  getReasoningConclusions,
  replaceReasoningConclusions,
  insertShadowWeightingComputation,
};

export { pool };
