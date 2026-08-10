-- Matching Scoring Service - Step 2 (remaining-monolith migration: complete the scoring engine).
-- Owns match_scores and match_features going forward - the write-through historical logging
-- tables matchingApi.ts's rankCandidatesForJob (tier: 'full', persist: {...}) and featureStore.ts
-- always wrote, ported here unchanged. Confirmed via a real grep across the whole monolith
-- (db.getMatchScores/db.getMatchFeatures) that NEITHER table has ever had a single read consumer
-- anywhere in this codebase - both were always write-only historical records for future training/
-- analysis work that was never built. That makes this a safe, real, full cutover from day one
-- (the same reasoning matching-bge-shadow-service's bge_retrieval_shadow_comparisons cutover used
-- in this migration's very first batch) - no dual-write, no shadow-of-a-shadow needed.
--
-- Cross-service FKs dropped, same pattern as matching-decision-service's swipes/recruiter_notes:
-- the monolith's own match_scores.candidate_id had a real FK to candidates(id) and
-- match_features.candidate_id/match_scores/match_features.company_id had real FKs to
-- candidates(id)/companies(id) - none of those tables live in this service's database, so the
-- constraints are dropped, not weakened; every column/type/default is otherwise sourced directly
-- from schema.sql, nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS match_scores (
  id               SERIAL PRIMARY KEY,
  company_id       INTEGER NOT NULL,
  job_id           INTEGER NOT NULL,
  candidate_id     INTEGER NOT NULL,
  feature_score    NUMERIC,
  embedding_score  NUMERIC,
  ml_score         NUMERIC,
  final_score      NUMERIC,
  rank             INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_match_scores_company_id ON match_scores(company_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_job_id ON match_scores(job_id);

CREATE TABLE IF NOT EXISTS match_features (
  id                       SERIAL PRIMARY KEY,
  company_id               INTEGER NOT NULL,
  job_id                   INTEGER NOT NULL,
  candidate_id             INTEGER NOT NULL,
  feature_schema_version   INTEGER NOT NULL DEFAULT 1,
  jaccard_skill_score      NUMERIC NOT NULL,
  cosine_text_score        NUMERIC NOT NULL,
  cosine_bert_score        NUMERIC NOT NULL,
  euclidean_feature_score  NUMERIC NOT NULL,
  experience_score         NUMERIC NOT NULL,
  location_score           NUMERIC NOT NULL,
  salary_score             NUMERIC NOT NULL,
  levenshtein_title_score  NUMERIC NOT NULL,
  weighting                VARCHAR(10) NOT NULL DEFAULT 'static',
  tier                     VARCHAR(10) NOT NULL DEFAULT 'full',
  model_version            VARCHAR(50),
  source                   VARCHAR(30) NOT NULL,
  computed_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_match_features_job_candidate ON match_features(job_id, candidate_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_features_company ON match_features(company_id);

INSERT INTO schema_migrations (version) VALUES ('002_match_scores')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
