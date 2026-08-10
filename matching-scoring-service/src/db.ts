/**
 * PostgreSQL connection pool and data-access functions for Matching Scoring Service's own
 * database - scoring_computations, owned and written directly by this service's own ported
 * pipeline. No dual-write, no mirror of any other table - every input this service's pipeline
 * needs is passed in the request body by the monolith (see routes/scoring.routes.ts).
 *
 * match_scores/match_features (Step 2 of the remaining-monolith migration) are a REAL, full
 * cutover, not a mirror - ported from the monolith's own db.saveMatchScore/saveMatchFeatures
 * unchanged. Confirmed via a repo-wide grep that neither table has ever had a read consumer
 * anywhere - see migrations/002_match_scores_and_features.up.sql's header comment for the full
 * reasoning.
 */
import pkg from 'pg';
import type { MatchScore, MatchFeatureRecord } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_scoring',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-scoring-service PostgreSQL pool error:', err);
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

export async function insertScoringComputation(input: {
  request_kind: 'candidates_batch' | 'jobs_batch';
  job_id: number;
  subject_count: number;
  model_type: string;
  results: unknown;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO scoring_computations (request_kind, job_id, subject_count, model_type, results)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.request_kind, input.job_id, input.subject_count, input.model_type, JSON.stringify(input.results)]
    );
  } catch (error) {
    console.error('Error logging scoring computation:', error);
  }
}

export async function saveMatchScore(score: Omit<MatchScore, 'id' | 'created_at'>): Promise<MatchScore | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_scores (company_id, job_id, candidate_id, feature_score, embedding_score, ml_score, final_score, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [score.company_id, score.job_id, score.candidate_id, score.feature_score, score.embedding_score, score.ml_score, score.final_score, score.rank]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving match score:', error);
    return null;
  }
}

export async function saveMatchFeatures(record: Omit<MatchFeatureRecord, 'id' | 'computed_at'>): Promise<MatchFeatureRecord | null> {
  try {
    const result = await pool.query(
      `INSERT INTO match_features (
         company_id, job_id, candidate_id, feature_schema_version,
         jaccard_skill_score, cosine_text_score, cosine_bert_score, euclidean_feature_score,
         experience_score, location_score, salary_score, levenshtein_title_score,
         weighting, tier, model_version, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        record.company_id, record.job_id, record.candidate_id, record.feature_schema_version,
        record.jaccard_skill_score, record.cosine_text_score, record.cosine_bert_score, record.euclidean_feature_score,
        record.experience_score, record.location_score, record.salary_score, record.levenshtein_title_score,
        record.weighting, record.tier, record.model_version, record.source,
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving match features:', error);
    return null;
  }
}

export const db = { healthCheck, insertScoringComputation, saveMatchScore, saveMatchFeatures };

export { pool };
