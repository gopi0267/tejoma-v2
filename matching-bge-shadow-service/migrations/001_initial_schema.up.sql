-- Matching BGE Shadow Service - Batch 28 - initial schema.
-- Owns (Batch 28 domain audit): bge_retrieval_shadow_comparisons - the only write
-- src/matching/bgeShadowRetrieval.ts's pipeline ever performs. Unlike every other table this
-- migration series has moved, this one has ZERO real reporting consumers in the monolith
-- (confirmed via grep across src/ - only db.ts/types.ts/bgeShadowRetrieval.ts itself ever
-- reference it) and its own module doc already states "SHADOW MODE ONLY - never affects which
-- candidates a recruiter sees or their order." That makes this the lowest-risk extraction in the
-- whole series: there is no authoritative monolith computation to preserve or dual-write from -
-- this service becomes the sole, real owner of this table from day one, no shadow-of-a-shadow
-- pattern needed (contrast Batch 26/27, both of which extracted computations with real downstream
-- consumers).
--
-- company_id had a real FK to companies(id) in the monolith's own copy - dropped here (cross-
-- service-FK-elimination, same pattern used throughout this migration; Tenant Directory Service
-- owns companies). job_id already had no FK in the monolith's own copy (schema.sql) - nothing to
-- drop there.
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bge_retrieval_shadow_comparisons (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER NOT NULL,
  job_id                INTEGER NOT NULL,
  pool_size             INTEGER NOT NULL,
  existing_ranking      JSONB NOT NULL,
  bge_ranking           JSONB,
  top10_overlap_count   INTEGER,
  top10_overlap_pct     NUMERIC,
  rank_correlation      NUMERIC,
  bge_available         BOOLEAN NOT NULL,
  embed_latency_ms      NUMERIC,
  rerank_latency_ms     NUMERIC,
  computed_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bge_retrieval_shadow_job ON bge_retrieval_shadow_comparisons(job_id);
CREATE INDEX IF NOT EXISTS idx_bge_retrieval_shadow_company ON bge_retrieval_shadow_comparisons(company_id);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
