-- Matching Evaluation Service - Tier 0 (Batch 24) - initial schema.
-- Owns (Batch 24 domain audit): match_evaluation_runs and ltr_model_versions - the two tables
-- with a simple, single-writer relationship to this service's two source files (evaluation.ts,
-- learningToRank.ts). Everything else in the original "Matching domain" audit (skill/role
-- intelligence, career intelligence, reasoning, shadow scoring, the live scoring engine itself)
-- stays on the monolith - see README.md's "Why this batch is scoped this narrowly".
--
-- match_evaluation_runs.company_id has NO foreign key here - companies is Tenant Directory
-- Service's table, not this service's - the same cross-service-FK-elimination pattern already
-- applied throughout this migration series. It remains a plain scoping column (still indexed,
-- still used in every query exactly as before).
--
-- ltr_model_versions has no company scoping at all (training is pooled across every company, same
-- as the monolith's own ensemble training - see learningToRank.ts's own comment on this), so
-- nothing to eliminate there.
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's
-- own schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ltr_model_versions (source: schema.sql "ltr_model_versions")
-- ============================================================================
CREATE TABLE IF NOT EXISTS ltr_model_versions (
  id                 SERIAL PRIMARY KEY,
  version            VARCHAR(50) NOT NULL,
  algorithm          VARCHAR(60) NOT NULL,
  training_examples  INTEGER NOT NULL,
  training_groups    INTEGER NOT NULL,
  ndcg_at_10         NUMERIC(6,4),
  trained_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active          BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- match_evaluation_runs (source: schema.sql "match_evaluation_runs")
-- ============================================================================
CREATE TABLE IF NOT EXISTS match_evaluation_runs (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL,
  evaluated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  jobs_evaluated    INTEGER NOT NULL,
  swipes_evaluated  INTEGER NOT NULL,
  k                 INTEGER NOT NULL,
  ndcg_at_k         NUMERIC(6,4),
  map_at_k          NUMERIC(6,4),
  mrr               NUMERIC(6,4),
  precision_at_k    NUMERIC(6,4),
  recall_at_k       NUMERIC(6,4),
  data_volume_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_match_evaluation_runs_company ON match_evaluation_runs(company_id, evaluated_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
