-- Dynamic Weighting / Explainable Matching Service - Batch 33 - initial schema.
--
-- NO OWNED TABLE. Unlike every prior batch, this service computes and returns - it never persists
-- anything. resolveSkillTiers/computeSeniorityAdjustedWeights/computeDynamicSkillScore (ported
-- from dynamicWeighting.ts), buildMatchExplanation (explainability.ts, the SINGULAR file - not the
-- separate, genuinely live explainability/ folder, which stays on the monolith untouched), and
-- hybridRetrieveCandidates (retrieval.ts) are all pure functions over data the caller already has
-- plus this service's own mirrors below - there is no "result row" to store, only a computed
-- response to a caller.
--
-- THREE read-only, dual-write mirrors (the monolith remains the sole writer of all three):
--   - skill_nodes: FOURTH independent mirror target (alongside matching-reasoning-service,
--     matching-skill-discovery-service, and matching-evaluation-service - Batches 26/27/31),
--     needed by this service's own ported canonicalizeSkill.
--   - skill_edges: SECOND independent mirror target (alongside matching-reasoning-service's own,
--     Batch 26 - matching-skill-discovery-service/matching-evaluation-service never read it),
--     needed by computeDynamicSkillScore's graph-related matching and
--     GraphExpandedSkillStrategy's one-hop expansion. Same-service FK to skill_nodes KEPT (not
--     cross-service - both tables live in this one service's own database).
--   - role_profiles: FOURTH independent mirror target (alongside role-intelligence-service,
--     career-intelligence-service, and matching-evaluation-service - Batches 29/30/31), needed by
--     resolveSkillTiers's findLexicalRoleMatch.
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS skill_edges (
  id                  SERIAL PRIMARY KEY,
  from_skill_id       INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  to_skill_id         INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  relationship_type   VARCHAR(30) NOT NULL,
  weight              NUMERIC NOT NULL DEFAULT 1.0,
  source              VARCHAR(30) NOT NULL DEFAULT 'curated',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_edges_unique_triple UNIQUE (from_skill_id, to_skill_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_skill_edges_from ON skill_edges(from_skill_id, relationship_type);

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
