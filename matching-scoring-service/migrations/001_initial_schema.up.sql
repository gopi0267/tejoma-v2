-- Matching Scoring Service - initial schema (full-migration continuation, live-scoring-engine
-- extraction). Owns scoring_computations - one row per shadow-comparison call the monolith makes
-- after every REAL calculateMatchScoresBatch/calculateMatchScoresForJobsBatch call it serves.
--
-- Unlike bge_retrieval_shadow_comparisons (Batch 28, zero real consumers, safe full cutover), the
-- computation being shadowed here IS the live, real, recruiter/candidate-facing match score - the
-- single highest-blast-radius piece of this whole migration, called out as such since the first
-- batch. This service therefore follows the matching-reasoning-service (Batch 26) shape, not the
-- bge-shadow shape: the monolith's own computation stays the sole source of truth and is
-- completely unchanged; this service computes independently (ported, not shared, code - see
-- src/matching/services.ts's header comment) and stores its own result for its own historical
-- record, while the actual AGREE/DIVERGE comparison and logging happens on the monolith side
-- (src/matchingScoringServiceShadow.ts), exactly like reasoningServiceShadow.ts already does.
--
-- No dual-write, no mirror of any monolith table - every input this service's pipeline needs
-- (job, candidates, modelType) is passed directly in the request body by the monolith, which
-- already has all of it in memory at the point it calls this service.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scoring_computations (
  id                SERIAL PRIMARY KEY,
  request_kind      VARCHAR(32) NOT NULL, -- 'candidates_batch' | 'jobs_batch'
  job_id            INTEGER NOT NULL,
  subject_count     INTEGER NOT NULL, -- number of candidates (candidates_batch) or jobs (jobs_batch) scored
  model_type        VARCHAR(32) NOT NULL,
  results           JSONB NOT NULL, -- this service's own computed MatchScoreResult[] (feature_score/embedding_score/ml_score/final_score/breakdown), summary always ''
  computed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scoring_computations_job ON scoring_computations(job_id);
CREATE INDEX IF NOT EXISTS idx_scoring_computations_computed_at ON scoring_computations(computed_at);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
