-- Phase 3 (Feature Store, Feedback Learning, Learning-to-Rank, Evaluation Framework) of the
-- Enterprise AI Matching Architecture. Purely additive: three new tables, nothing existing is
-- dropped, retyped, or renamed. Safe to run multiple times (IF NOT EXISTS throughout).
--
-- SCOPE NOTE: no new column is added to swipes/candidate_decisions/candidate_application_status -
-- the Feedback Learning Engine (src/matching/feedbackSignals.ts) widens the ensemble's training
-- signal using those tables' EXISTING columns only (swipes.action's previously-discarded 0.5
-- value, candidate_application_status as label corroboration). No interview/offer/joined/
-- withdrawn/viewed lifecycle stage is represented anywhere in this file - none of those exist in
-- this schema, and none are fabricated here.

-- ============================================================================
-- 1. Feature Store - match_features
--
-- Append-only, immutable (never UPDATEd, matching match_scores' existing write-through
-- convention): one row per (job, candidate) scoring event, storing the EXACT 8-dimensional
-- feature vector fed to the ML ensemble at that moment (see FEATURE_NAMES in
-- python-services/matching-ml-service/ensemble.py - column order below matches it exactly),
-- not a reconstruction. computed_at gives point-in-time correctness: a future training job can
-- join swipes/candidate_application_status back to the match_features row that was actually
-- current when the recruiter made their decision, instead of recomputing features from
-- candidate/job rows that may have since been edited (the classic training-serving skew this
-- table exists to prevent). feature_schema_version lets the 8-column shape change later without
-- breaking historical rows - a reader always checks the version before interpreting columns.
-- ============================================================================
CREATE TABLE IF NOT EXISTS match_features (
  id                       SERIAL PRIMARY KEY,
  company_id               INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                   INTEGER NOT NULL,
  candidate_id             INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  feature_schema_version   INTEGER NOT NULL DEFAULT 1,
  jaccard_skill_score      NUMERIC NOT NULL,
  cosine_text_score        NUMERIC NOT NULL,
  cosine_bert_score        NUMERIC NOT NULL,
  euclidean_feature_score  NUMERIC NOT NULL,
  experience_score         NUMERIC NOT NULL,
  location_score           NUMERIC NOT NULL,
  salary_score             NUMERIC NOT NULL,
  levenshtein_title_score  NUMERIC NOT NULL,
  -- Which weighting/tier scoring path produced this vector (matchingApi.ts's MatchWeighting/
  -- MatchTier) - lets future training deliberately filter to e.g. only 'static'-weighted vectors
  -- if 'dynamic' is later found to shift the feature distribution.
  weighting                VARCHAR(10) NOT NULL DEFAULT 'static',
  tier                     VARCHAR(10) NOT NULL DEFAULT 'full',
  -- activeModelType at computation time (services.ts) - which model family actually consumed
  -- this vector, if any.
  model_version             VARCHAR(50),
  -- Which of the four Unified Matching API surfaces produced this row (recruiter_search /
  -- candidate_discovery / swipe_queue / job_detail) - only 'full'-tier calls with real
  -- candidates/jobs rows persist at all (see matchingApi.ts's persistCandidateMatchScores,
  -- mirrored here), same restriction as match_scores.
  source                   VARCHAR(30) NOT NULL,
  computed_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_features_job_candidate ON match_features(job_id, candidate_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_features_company ON match_features(company_id);

-- ============================================================================
-- 2. Learning-to-Rank - ltr_model_versions
--
-- Deliberately SEPARATE from model_versions (which tracks the production RandomForest/XGBoost/
-- LightGBM classification ensemble - see src/api/ml.routes.ts). Per this phase's explicit scope
-- ("parallel... do not replace or modify the current production classifier... keep the ranking
-- pipeline isolated until fully validated"), no Learning-to-Rank row is ever written to
-- model_versions, and no LTR model is read by src/matching/matchingApi.ts or src/services.ts -
-- this table exists purely to record isolated training runs of the new grouped
-- XGBRanker/LGBMRanker models until a future phase deliberately decides to wire one into live
-- scoring (a config/read-path change at that point, not a schema change).
-- ============================================================================
CREATE TABLE IF NOT EXISTS ltr_model_versions (
  id                 SERIAL PRIMARY KEY,
  version            VARCHAR(50) NOT NULL,
  -- Open string (not a fixed-width enum column) - ranker.py trains XGBRanker + LGBMRanker
  -- jointly as one ensemble per run (e.g. 'xgboost_ranker+lightgbm_ranker'), same as
  -- ensemble.py's classifier - VARCHAR(60) leaves room for that combined value plus future
  -- additions without another width migration.
  algorithm          VARCHAR(60) NOT NULL,
  training_examples  INTEGER NOT NULL,
  training_groups    INTEGER NOT NULL, -- number of distinct jobs (rank groups) trained on
  ndcg_at_10         NUMERIC(6,4),
  trained_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active          BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- 3. Evaluation Framework - match_evaluation_runs
--
-- Historical record of ranking-quality evaluation runs (NDCG@K/MAP@K/MRR/Precision@K/Recall@K),
-- computed from real swipes.match_score + swipes.action grouped by job_id (see
-- src/matching/evaluation.ts). company_id-scoped like every other tenant-facing table - a
-- recruiter's evaluation history never mixes another company's swipe data. data_volume_note
-- records the honest caveat that comes with evaluating on this database's current swipe volume,
-- rather than silently presenting a metric a reader might assume is statistically robust.
-- ============================================================================
CREATE TABLE IF NOT EXISTS match_evaluation_runs (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
