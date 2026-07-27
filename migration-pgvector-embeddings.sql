-- ============================================================================
-- BLOCKED ON INFRASTRUCTURE - DO NOT RUN AGAINST THIS DATABASE YET
-- ============================================================================
-- Part of Phase 0 (Foundation & Unified Serving) of the Enterprise AI Matching Architecture:
-- "pgvector installed, HNSW indexing on existing embeddings."
--
-- Verified directly against this Postgres instance (2026, Postgres 18.1):
--   SELECT * FROM pg_available_extensions WHERE name = 'vector';   -- returns 0 rows
--   SELECT extname FROM pg_extension;                              -- plpgsql, pg_trgm only
--
-- pg_available_extensions returning zero rows means the pgvector shared library/control file is
-- not present on the Postgres SERVER itself - this is not something CREATE EXTENSION, a SQL
-- migration, or any application-code change can fix. It requires installing the pgvector
-- extension binary that matches this exact Postgres major version (18) on the machine/container
-- running Postgres, e.g.:
--   - Debian/Ubuntu:  apt-get install postgresql-18-pgvector
--   - Homebrew:       brew install pgvector
--   - Windows:        the precompiled release matching PG18 from
--                      https://github.com/pgvector/pgvector/releases, with vector.dll and the
--                      extension/vector--*.sql + vector.control files copied into this Postgres
--                      installation's lib/ and share/extension/ directories
--   - Managed Postgres (RDS/Cloud SQL/Supabase/etc.): enable "vector" from the provider's
--     extension allow-list (no server file access needed there)
--
-- Once `SELECT * FROM pg_available_extensions WHERE name = 'vector'` returns a row on this
-- database, run this file. Every statement below is additive and idempotent (IF NOT EXISTS /
-- guarded), matching the same discipline as migration-phase0-unified-matching.sql - it does not
-- touch the existing resume_embedding/description_embedding DOUBLE PRECISION[] columns, so the
-- current embedding-generation and cosine-similarity code paths keep working unmodified and
-- un-degraded until the new columns are explicitly wired in by a later phase.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- New, parallel vector-typed columns - additive, existing DOUBLE PRECISION[] columns untouched.
-- 384 dimensions matches the existing all-MiniLM-L6-v2 model already in production
-- (python-services/matching-ml-service/embeddings.py) - no model change, just a storage/index
-- upgrade for the vectors that model already produces.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_embedding_vec vector(384);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_embedding_vec vector(384);

-- Backfill from the existing plain-array columns. array_to_string/split round-trip is the
-- standard way to cast a DOUBLE PRECISION[] into pgvector's vector(n) input format; rows with a
-- NULL or empty existing embedding are left NULL here too (nothing to backfill).
UPDATE candidates
SET resume_embedding_vec = resume_embedding::text::vector
WHERE resume_embedding_vec IS NULL
  AND resume_embedding IS NOT NULL
  AND array_length(resume_embedding, 1) = 384;

UPDATE jobs
SET description_embedding_vec = description_embedding::text::vector
WHERE description_embedding_vec IS NULL
  AND description_embedding IS NOT NULL
  AND array_length(description_embedding, 1) = 384;

-- HNSW indexes, cosine-distance ops (matches the cosine similarity already computed in
-- src/utils/embeddings.ts / services.ts's vectorCosineSimilarity - same metric, now indexable).
CREATE INDEX IF NOT EXISTS idx_candidates_resume_embedding_vec
  ON candidates USING hnsw (resume_embedding_vec vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_description_embedding_vec
  ON jobs USING hnsw (description_embedding_vec vector_cosine_ops);

-- ============================================================================
-- NOT included in this migration, deliberately deferred to a later phase (once this migration
-- has actually been applied and the new indexes have real data behind them):
--   - Switching src/matching/embeddingIndex.ts to WRITE resume_embedding_vec/
--     description_embedding_vec going forward (dual-write, same discipline as skills_array in
--     migration-phase0-unified-matching.sql).
--   - Switching services.ts's computeBertCosineScore to an indexed ANN query instead of the
--     current hand-rolled in-memory cosine over the plain-array column.
--   - Dropping the plain-array columns (never planned - additive only, per this architecture's
--     own design principles).
-- ============================================================================
