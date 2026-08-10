-- Matching Evaluation Service - Batch 25 - adds proficiency_shadow_scores.
-- Owns (Batch 25 domain audit): the shadow-scoring signal table two read-only reporting surfaces
-- need - shadowDataHealth.ts (GET /shadow-data-health) and proficiencyAnalytics.ts
-- (GET /proficiency-analytics). Unlike ltr_model_versions/match_evaluation_runs (Batch 24, written
-- directly by this service's own ported logic), this service NEVER writes to this table itself -
-- it's populated entirely by real-time dual-write from the monolith's UNCHANGED
-- src/matching/shadowScoring.ts (fired from swipe.routes.ts/recruiter-review.routes.ts on every
-- decision). shadowScoring.ts itself stays on the monolith - its computation depends on
-- career/proficiency/recency/reasoning weighting modules that are still deeply coupled to the
-- not-yet-extracted skill/role/career intelligence stack (see this service's own README.md).
--
-- company_id and candidate_id have NO foreign keys here - companies is Tenant Directory Service's
-- table, candidates remains monolith-owned - the usual cross-service-FK-elimination pattern. Note
-- job_id already has no FK in the monolith's own copy of this table (schema.sql) - nothing to
-- drop there.
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's
-- own schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS proficiency_shadow_scores (
  id                          SERIAL PRIMARY KEY,
  company_id                  INTEGER NOT NULL,
  candidate_id                INTEGER NOT NULL,
  job_id                      INTEGER NOT NULL,
  base_match_score            NUMERIC NOT NULL,
  proficiency_adjusted_score  NUMERIC NOT NULL,
  overall_multiplier          NUMERIC NOT NULL,
  skill_multipliers           JSONB NOT NULL,
  computed_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision_action              NUMERIC,
  career_multiplier            NUMERIC,
  career_progression_signal    NUMERIC,
  career_stability_signal      NUMERIC,
  career_domain_signal         NUMERIC,
  career_adjusted_score        NUMERIC,
  career_progression_type      VARCHAR(20),
  recency_multiplier            NUMERIC,
  recency_adjusted_score        NUMERIC,
  recency_role_expectation      VARCHAR(10),
  recency_skill_multipliers     JSONB,
  reasoning_multiplier          NUMERIC,
  reasoning_density_signal      NUMERIC,
  reasoning_coverage_signal     NUMERIC,
  reasoning_quality_signal      NUMERIC,
  reasoning_adjusted_score      NUMERIC,
  reasoning_covered_domains     JSONB,
  reasoning_uncovered_domains   JSONB
);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_company ON proficiency_shadow_scores(company_id);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_candidate_job ON proficiency_shadow_scores(candidate_id, job_id);

INSERT INTO schema_migrations (version) VALUES ('002_shadow_scores')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
