-- BGE-M3 + BGE-Reranker-v2-m3 retrieval shadow comparison, SHADOW MODE ONLY.
--
-- Append-only event log (same convention as swipes/proficiency_shadow_scores - one row per
-- comparison, never updated). Records how a BGE-based ranking of the SAME candidate pool would
-- have differed from the existing live ranking (BM25 + MiniLM hybrid retrieval, unchanged) -
-- never used to actually rank or select candidates. bge_available=false rows are expected and
-- normal: nothing starts the BGE service automatically, so most rows will simply record "not
-- reachable" until it's explicitly run for local testing or pointed at a real deployment.
CREATE TABLE IF NOT EXISTS bge_retrieval_shadow_comparisons (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
