/**
 * PostgreSQL connection pool and data-access functions for Chat Service's own database
 * (Batch 17 domain audit) - knowledge_base_chunks, moved out of the monolith's shared database.
 *
 * Ported from the monolith's src/db.ts (same query shapes, same error-handling convention) with
 * one adjustment: company_id has no FK here (migrations/001_initial_schema.up.sql's header
 * comment explains why). No dual-write back to the monolith from here - this service's own
 * routes only ever read/write its own database, exactly like every other Tier 0 service.
 */
import pkg from 'pg';
import type { KnowledgeChunk } from './types.js';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tejoma_chat',
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
});

pool.on('error', (err) => {
  console.error('chat-service PostgreSQL pool error:', err);
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

export async function upsertKnowledgeChunk(chunk: {
  company_id: number | null;
  source_type: 'candidate' | 'job' | 'company';
  source_id: number;
  content: string;
  embedding: number[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO knowledge_base_chunks (company_id, source_type, source_id, content, embedding)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_type, source_id)
     DO UPDATE SET company_id = $1, content = $4, embedding = $5, updated_at = CURRENT_TIMESTAMP`,
    [chunk.company_id, chunk.source_type, chunk.source_id, chunk.content, chunk.embedding]
  );
}

export async function deleteKnowledgeChunk(sourceType: 'candidate' | 'job' | 'company', sourceId: number): Promise<void> {
  await pool.query('DELETE FROM knowledge_base_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);
}

export async function getKnowledgeChunksForCompany(companyId: number): Promise<KnowledgeChunk[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM knowledge_base_chunks WHERE company_id IS NULL OR company_id = $1`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching knowledge base chunks:', error);
    return [];
  }
}

export const db = {
  healthCheck,
  upsertKnowledgeChunk,
  deleteKnowledgeChunk,
  getKnowledgeChunksForCompany,
};

export { pool };
