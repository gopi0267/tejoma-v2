-- Career Intelligence Service - Batch 30 - initial schema.
-- Owns (Batch 30 domain audit): career_trajectories - job-sequence normalization, progression/
-- transition analysis, stability/domain analysis, trajectory embedding, and future-role
-- prediction, computed by this service's own ported pipeline. UNLIKE reasoning_conclusions/
-- skill_discovery_proposals (Batches 26/27), the monolith's OWN career_trajectories table has
-- real, live (if fire-and-forget) readers still on the monolith - careerWeighting.ts (part of the
-- real shadow-scoring pipeline) and explainability/computeExplanation.ts (the real, if less-hot,
-- recruiter-review explanation endpoint) both call db.getCareerTrajectory() directly. So this
-- service's own career_trajectories table is NOT a mirror of the monolith's - it's an
-- independently-computed copy, populated only when the monolith's shadow-validation client
-- triggers this service; the monolith's own table remains fully authoritative for those two real
-- readers, untouched by this batch.
--
-- Also owns a dual-written, read-only-from-this-service's-own-code mirror of role_profiles - a
-- second, fully independent mirror alongside Role Intelligence Service's own (Batch 29). Needed
-- because normalizeJobSequence/resolveJobRole and predictNextRoles both resolve a free-text title
-- against the real role_profiles data.
--
-- Cross-service FKs dropped: career_trajectories.candidate_id/company_id referenced
-- candidates(id)/companies(id) in the monolith's own copy - both cross-service, dropped here
-- (plain scoping integers). role_profiles has no FK in the monolith's own schema.sql - nothing to
-- drop there.
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS career_trajectories (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL,
  company_id            INTEGER NOT NULL,
  job_sequence                JSONB NOT NULL,
  total_career_months        INTEGER,
  role_count                 INTEGER,
  progression_type           VARCHAR(20),
  seniority_level             VARCHAR(20),
  seniority_trend             VARCHAR(20),
  transitions                JSONB,
  avg_tenure_months           NUMERIC,
  median_tenure_months        NUMERIC,
  tenure_pattern               VARCHAR(20),
  gaps                        JSONB,
  domain_concentration         NUMERIC,
  domains                      JSONB,
  trajectory_embedding         DOUBLE PRECISION[],
  predicted_next_roles         JSONB,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT career_trajectories_candidate_unique UNIQUE (candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_candidate ON career_trajectories(candidate_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_company ON career_trajectories(company_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_seniority ON career_trajectories(seniority_level);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
