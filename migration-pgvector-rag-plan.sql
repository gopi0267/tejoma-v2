-- ============================================================================
-- NOT APPLIED. This is a prepared, ready-to-run migration for when pgvector is available on the
-- target Postgres instance - it is NOT installed on this dev database (confirmed via
-- `SELECT * FROM pg_available_extensions WHERE name = 'vector'`, which returns zero rows: the
-- extension binary itself isn't present, so `CREATE EXTENSION vector` would fail outright here).
-- pgvector is available out of the box on most managed Postgres providers (Supabase, Neon, RDS
-- 15.something+, Cloud SQL) and via a one-line install on self-managed Linux; it is simply not
-- bundled with a stock Windows Postgres install, which is what this dev environment runs.
--
-- WHY THIS IS NEEDED (measured, not assumed): rag.service.ts's retrieveRelevantChunks() fetches
-- every knowledge_base_chunks row for a company and computes cosine similarity in Node, once per
-- chat message. Benchmarked against 50,000 synthetic chunks (a realistic mid-scale company's
-- combined candidate+job chunk count) in an isolated throwaway database:
--   - Server-side SQL execution (EXPLAIN ANALYZE): 17ms - the query itself is not the problem.
--   - Actual client round-trip to fetch those 50,000 rows: ~24.3 SECONDS.
--   - In-process cosine-similarity ranking once the data is in memory: 73ms - also not the
--     problem.
-- The bottleneck is almost entirely the wire transfer and client-side parsing of 50,000 large
-- `double precision[768]` array columns, which node-postgres receives and parses as verbose
-- text-format array literals (each of the 768 floats per row transmitted as ASCII text, not
-- binary) - not the SQL query, not the ranking math. pgvector's native `vector` type uses a
-- compact wire format and lets the ORDER BY ... LIMIT itself happen inside Postgres via an index,
-- so the 50,000-row transfer never needs to happen at all: only the top-K results cross the wire.
--
-- ADDITIVE ONLY - a new column alongside the existing one, not a replacement. See the cutover
-- plan at the bottom for how retrieveRelevantChunks would actually switch over, which this
-- migration deliberately does NOT do - the existing plain-array column and the existing
-- retrieval code path are both left completely functional throughout, so this can be applied to
-- a production database ahead of the code cutover with zero behavior change on its own.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- 768 matches EMBEDDING_DIMENSIONS in src/utils/embeddings.ts (gemini-embedding-001, truncated
-- via Matryoshka outputDimensionality) - keep these in sync if that ever changes.
ALTER TABLE knowledge_base_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(768);

-- One-time backfill from the existing double precision[] column. Safe to run repeatedly (only
-- touches rows where the new column is still NULL) and safe to run against a live table -
-- SELECT/UPDATE, no lock beyond a normal row-level UPDATE, no downtime.
UPDATE knowledge_base_chunks
SET embedding_vector = embedding::vector
WHERE embedding_vector IS NULL AND embedding IS NOT NULL;

-- HNSW: the modern default choice over IVFFlat for this scale - no separate "training" step
-- required (IVFFlat's list count needs to be chosen relative to row count and re-tuned as the
-- table grows; HNSW doesn't have that operational burden), and better recall at the row counts
-- this table will realistically reach. vector_cosine_ops matches the existing cosineSimilarity()
-- metric exactly - the ranking math itself doesn't change, only where it runs.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_embedding_hnsw
  ON knowledge_base_chunks USING hnsw (embedding_vector vector_cosine_ops);

COMMIT;

-- ============================================================================
-- CUTOVER PLAN (code changes, not part of this migration - listed here for the team to execute
-- as a separate, deliberate step once this schema change has been applied and backfilled in
-- production):
--
-- 1. rag.service.ts's indexCandidate()/indexJob() start writing embedding_vector alongside the
--    existing embedding column on every upsert (both columns populated from the same embedText()
--    call - one extra assignment, no new embedding API calls, no behavior change to what gets
--    embedded or how).
-- 2. Run this migration's backfill UPDATE again to catch any rows written before step 1 shipped.
-- 3. Only then, retrieveRelevantChunks() switches from "fetch all + rank in Node" to:
--      SELECT source_type, source_id, content, 1 - (embedding_vector <=> $1) AS score
--      FROM knowledge_base_chunks
--      WHERE company_id IS NULL OR company_id = $2
--      ORDER BY embedding_vector <=> $1
--      LIMIT 8
--    (<=> is pgvector's cosine-distance operator; 1 - distance reconstructs the same 0-1
--    similarity score cosineSimilarity() already returns, so MIN_SIMILARITY's 0.3 floor and
--    every downstream consumer of `score` keeps working unchanged - filter score >= 0.3 in the
--    application layer after the query, exactly as today, to keep this a pure retrieval-
--    mechanism swap with no scoring-semantics change.)
--    HNSW is approximate nearest-neighbor, not exact - the top-8 it returns could differ at the
--    margin from an exact full-scan ranking in rare cases. This is the one place this plan is
--    NOT a byte-for-byte guaranteed-identical swap, which is exactly why it's a separate,
--    deliberate cutover step requiring sign-off, not something bundled into this hardening pass.
-- 4. Once retrieveRelevantChunks no longer reads the old embedding column, it (and the old
--    plain-array storage) can be dropped in a later migration - not before, and not as part of
--    this one.
-- ============================================================================
