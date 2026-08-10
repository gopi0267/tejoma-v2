/**
 * PostgreSQL connection pool and data-access functions for Matching BGE Shadow Service's own
 * database (Batch 28) - bge_retrieval_shadow_comparisons, owned and written directly by this
 * service's own ported pipeline. No dual-write, no mirror of any other table - this service's
 * pipeline needs nothing from the monolith beyond what swipe.routes.ts already passes in the
 * request body (see routes/internal.routes.ts).
 *
 * Ported from the monolith's src/db.ts (same query shape, same error-handling convention).
 */
import pkg from 'pg';
import type { RankingEntry } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_matching_bge_shadow',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('matching-bge-shadow-service PostgreSQL pool error:', err);
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

export async function insertBgeRetrievalShadowComparison(input: {
  company_id: number;
  job_id: number;
  pool_size: number;
  existing_ranking: RankingEntry[];
  bge_ranking: RankingEntry[] | null;
  top10_overlap_count: number | null;
  top10_overlap_pct: number | null;
  rank_correlation: number | null;
  bge_available: boolean;
  embed_latency_ms: number | null;
  rerank_latency_ms: number | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO bge_retrieval_shadow_comparisons (
         company_id, job_id, pool_size, existing_ranking, bge_ranking, top10_overlap_count,
         top10_overlap_pct, rank_correlation, bge_available, embed_latency_ms, rerank_latency_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.company_id, input.job_id, input.pool_size, JSON.stringify(input.existing_ranking),
        input.bge_ranking !== null ? JSON.stringify(input.bge_ranking) : null,
        input.top10_overlap_count, input.top10_overlap_pct, input.rank_correlation,
        input.bge_available, input.embed_latency_ms, input.rerank_latency_ms,
      ]
    );
  } catch (error) {
    console.error('Error logging BGE retrieval shadow comparison:', error);
  }
}

export const db = { healthCheck, insertBgeRetrievalShadowComparison };

export { pool };
