-- Role Intelligence Service - Batch 29 - initial schema.
-- Owns a dual-written, read-only-from-this-service's-own-code mirror of role_profiles. The
-- monolith remains the sole writer - scripts/seed-intelligence-layer.ts's unchanged
-- seedRoleProfiles() (src/matching/roleIntelligence.ts) is still the only thing that ever creates
-- or updates a role profile. This service's own upsertRoleProfile/patchRoleProfile in db.ts exist
-- only as dual-write's targets, never called by this service's own read-only logic.
--
-- Unlike every prior batch, role_profiles has NO foreign key of any kind in the monolith's own
-- copy (schema.sql) - a fully standalone table, nothing to drop here.
--
-- Real, still-live consumers remain on the monolith and are NOT affected by this extraction:
-- dynamicWeighting.ts, careerWeighting.ts, proficiencyWeighting.ts, recencyWeighting.ts, and
-- careerIntelligence/futureRolePrediction.ts all call db.getAllRoleProfiles() directly against the
-- monolith's own database - none of them go through src/matching/roleIntelligence.ts's own
-- wrapper functions, which is why this extraction can happen without touching any of them.
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

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
