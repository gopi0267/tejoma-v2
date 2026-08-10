-- Matching Evaluation Service - Batch 31 - adds the shadow-weighting cluster's input mirrors and
-- its own independently-computed output table.
--
-- Ports the ORCHESTRATOR (shadowScoring.ts) and its four signal modules (proficiencyWeighting.ts,
-- careerWeighting.ts, recencyWeighting.ts, reasoningWeighting.ts) that Batch 25's own migration
-- header comment already flagged as blocked on "the not-yet-extracted skill/role/career
-- intelligence stack" - now unblocked by Batches 26/27 (skill_nodes), 29 (role_profiles), and 30
-- (the career_trajectories/role_profiles precedent).
--
-- FOUR MIRROR TABLES, read-only from this service's own ported logic (the monolith remains the
-- sole writer of all four; dual-write targets only):
--   - skill_nodes: THIRD independent mirror target (alongside matching-reasoning-service and
--     matching-skill-discovery-service, Batches 26/27) - needed by this service's own ported
--     canonicalizeSkill.
--   - role_profiles: THIRD independent mirror target (alongside role-intelligence-service and
--     career-intelligence-service, Batches 29/30) - needed by this service's own ported
--     findLexicalRoleMatch/resolveJobRole.
--   - career_trajectories: this table's FIRST passive mirror anywhere in this migration. Unlike
--     career-intelligence-service's independently-computed copy (Batch 30, sparse - populated only
--     via shadow trigger), this service's ported careerWeighting.ts needs the monolith's real,
--     fully-populated table, read via a plain by-id lookup exactly like the monolith's original.
--   - reasoning_conclusions: this table's FIRST passive mirror anywhere in this migration, for the
--     same reason - matching-reasoning-service's own copy (Batch 26) is independently computed and
--     sparse; this service's ported reasoningWeighting.ts needs the monolith's real, complete
--     table. Mirrored via transactional delete+insert (a "replace" of the row-set per subject),
--     matching the monolith's own replaceReasoningConclusions semantics - see src/dualWrite.ts's
--     replaceReasoningConclusions (Batch 31).
--
-- ONE OWNED TABLE, written directly by this service's own ported shadowScoring.ts orchestrator:
--   - shadow_weighting_computations: this service's OWN independently-computed version of the same
--     four-signal chain the monolith's shadowScoring.ts computes into proficiency_shadow_scores
--     (already mirrored here since Batch 25, READ-ONLY, untouched by this migration). The two
--     tables intentionally coexist and are never merged - proficiency_shadow_scores is "what the
--     monolith actually computed" (the passive mirror, ground truth), shadow_weighting_computations
--     is "what this service's own independent computation produced" (for shadow-comparison only,
--     same "independent computation, shadow-validated" shape as reasoning_conclusions/
--     skill_discovery_proposals/career_trajectories in Batches 26/27/30). Same column shape as
--     proficiency_shadow_scores since it's computing the identical signal chain.
--
-- Cross-service FKs dropped throughout, consistent with every prior batch: career_trajectories.
-- candidate_id/company_id, reasoning_conclusions' polymorphic subject_id, shadow_weighting_
-- computations.company_id/candidate_id/job_id are all plain scoping integers, no FK.
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (or, for career_trajectories/role_profiles/skill_nodes/reasoning_conclusions, the
-- already introspection-verified copies in role-intelligence-service/career-intelligence-service/
-- matching-reasoning-service's own migrations) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS role_profiles (
  id                        SERIAL PRIMARY KEY,
  role_key                  VARCHAR(60) NOT NULL,
  display_name              VARCHAR(120) NOT NULL,
  mandatory_skills          TEXT[] NOT NULL DEFAULT '{}',
  preferred_skills          TEXT[] NOT NULL DEFAULT '{}',
  optional_skills           TEXT[] NOT NULL DEFAULT '{}',
  common_tools              TEXT[] NOT NULL DEFAULT '{}',
  typical_responsibilities  TEXT[] NOT NULL DEFAULT '{}',
  preferred_certifications  TEXT[] NOT NULL DEFAULT '{}',
  experience_band_min       NUMERIC,
  experience_band_max       NUMERIC,
  related_roles             TEXT[] NOT NULL DEFAULT '{}',
  career_progression        TEXT[] NOT NULL DEFAULT '{}',
  embedding                 DOUBLE PRECISION[],
  source                    VARCHAR(30) NOT NULL DEFAULT 'seed',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_profiles_role_key_key UNIQUE (role_key)
);

CREATE TABLE IF NOT EXISTS skill_nodes (
  id                  SERIAL PRIMARY KEY,
  canonical_name      VARCHAR(150) NOT NULL,
  category            VARCHAR(40) NOT NULL,
  technology_domain   VARCHAR(80),
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  popularity_score    NUMERIC DEFAULT 0,
  confidence          NUMERIC NOT NULL DEFAULT 1.0,
  is_deprecated       BOOLEAN NOT NULL DEFAULT false,
  is_emerging         BOOLEAN NOT NULL DEFAULT false,
  source              VARCHAR(30) NOT NULL DEFAULT 'dictionary',
  embedding           DOUBLE PRECISION[],
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_nodes_canonical_name_key UNIQUE (canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_category ON skill_nodes(category);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_aliases ON skill_nodes USING GIN (aliases);

CREATE TABLE IF NOT EXISTS career_trajectories (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL,
  company_id            INTEGER NOT NULL,
  job_sequence          JSONB NOT NULL,
  total_career_months   INTEGER,
  role_count            INTEGER,
  progression_type      VARCHAR(20),
  seniority_level       VARCHAR(20),
  seniority_trend       VARCHAR(20),
  transitions           JSONB,
  avg_tenure_months     NUMERIC,
  median_tenure_months  NUMERIC,
  tenure_pattern        VARCHAR(20),
  gaps                  JSONB,
  domain_concentration  NUMERIC,
  domains               JSONB,
  trajectory_embedding  DOUBLE PRECISION[],
  predicted_next_roles  JSONB,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT career_trajectories_candidate_unique UNIQUE (candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_candidate ON career_trajectories(candidate_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_company ON career_trajectories(company_id);

CREATE TABLE IF NOT EXISTS reasoning_conclusions (
  id                      SERIAL PRIMARY KEY,
  subject_type            VARCHAR(20) NOT NULL,
  subject_id              INTEGER NOT NULL,
  conclusion_text         TEXT NOT NULL,
  conclusion_type         VARCHAR(50) NOT NULL,
  reasoning_type          VARCHAR(30) NOT NULL,
  evidence_chain          JSONB NOT NULL,
  conclusion_confidence   NUMERIC NOT NULL,
  confidence_derivation   TEXT,
  derived_from            VARCHAR(60) NOT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_subject ON reasoning_conclusions(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS shadow_weighting_computations (
  id                            SERIAL PRIMARY KEY,
  company_id                    INTEGER NOT NULL,
  candidate_id                  INTEGER NOT NULL,
  job_id                        INTEGER NOT NULL,
  base_match_score               NUMERIC NOT NULL,
  proficiency_adjusted_score     NUMERIC NOT NULL,
  overall_multiplier             NUMERIC NOT NULL,
  skill_multipliers              JSONB NOT NULL,
  computed_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision_action                 NUMERIC,
  career_multiplier               NUMERIC,
  career_progression_signal       NUMERIC,
  career_stability_signal         NUMERIC,
  career_domain_signal            NUMERIC,
  career_adjusted_score           NUMERIC,
  career_progression_type         VARCHAR(20),
  recency_multiplier               NUMERIC,
  recency_adjusted_score           NUMERIC,
  recency_role_expectation         VARCHAR(10),
  recency_skill_multipliers        JSONB,
  reasoning_multiplier             NUMERIC,
  reasoning_density_signal         NUMERIC,
  reasoning_coverage_signal        NUMERIC,
  reasoning_quality_signal         NUMERIC,
  reasoning_adjusted_score         NUMERIC,
  reasoning_covered_domains        JSONB,
  reasoning_uncovered_domains      JSONB
);
CREATE INDEX IF NOT EXISTS idx_shadow_weighting_computations_company ON shadow_weighting_computations(company_id);
CREATE INDEX IF NOT EXISTS idx_shadow_weighting_computations_candidate_job ON shadow_weighting_computations(candidate_id, job_id);

INSERT INTO schema_migrations (version) VALUES ('003_shadow_cluster')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
