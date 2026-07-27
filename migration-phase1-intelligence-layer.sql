-- Phase 1 (Skill & Role Intelligence) of the Enterprise AI Matching Architecture.
-- Purely additive: three new tables, and new nullable columns on candidates/jobs. Nothing
-- existing is dropped, retyped, or renamed. Safe to run multiple times (IF NOT EXISTS throughout).
--
-- IMPORTANT SCOPE NOTE: none of this is read by src/services.ts's scoring functions yet. Per
-- the architecture's own phase ordering, wiring the skill graph / role profiles into live match
-- scoring is Phase 2 work ("Replace raw Jaccard skill overlap with graph-aware overlap"). Phase 1
-- only builds and populates the foundation - current matching behavior is unchanged by this file.

-- ============================================================================
-- 1. Skill Intelligence Platform
-- ============================================================================

-- One row per canonical skill. Aliases live on the node itself (an array), not as separate
-- SYNONYM_OF edges - a single row holding every known surface form is simpler to query ("does
-- this raw string resolve to a node") than N alias edges per skill, and is exactly how the
-- existing JD parser dictionary (src/jd-parser/dictionaries/skills.dictionary.ts) already models
-- it (`{canonical, category, aliases}`) - this table is a direct, structural extension of that
-- existing shape, not a new taxonomy invented from scratch.
CREATE TABLE IF NOT EXISTS skill_nodes (
  id                  SERIAL PRIMARY KEY,
  canonical_name      VARCHAR(150) NOT NULL,
  category            VARCHAR(40) NOT NULL,
  -- Mechanically derived from category (see src/matching/skillIntelligence.ts's
  -- CATEGORY_TO_DOMAIN map) - e.g. programming_language/frontend_framework/backend_framework ->
  -- "Software Engineering". Not a separate hand-curated taxonomy.
  technology_domain   VARCHAR(80),
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  -- Real, computed signal: occurrence count of this skill across candidates.skills_array +
  -- jobs.required_skills in THIS database, refreshed by
  -- skillIntelligence.refreshPopularityAndCooccurrence() - never a fabricated number.
  popularity_score    NUMERIC DEFAULT 0,
  -- 1.0 for every dictionary-sourced node (hand-curated, authoritative source). Lower values are
  -- reserved for a future Unknown Skill Discovery pipeline (Phase 4+) that has no equivalent in
  -- Phase 1 - no node created by this migration/seed will ever be below 1.0.
  confidence          NUMERIC NOT NULL DEFAULT 1.0,
  is_deprecated       BOOLEAN NOT NULL DEFAULT false,
  is_emerging         BOOLEAN NOT NULL DEFAULT false,
  -- Provenance - 'dictionary' for every Phase 1 seed row. Distinguishes hand-curated nodes from
  -- whatever a future Unknown Skill Discovery pipeline (out of scope this phase) would add.
  source              VARCHAR(30) NOT NULL DEFAULT 'dictionary',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_nodes_canonical_name_key UNIQUE (canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_category ON skill_nodes(category);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_aliases ON skill_nodes USING GIN (aliases);

-- Typed relationships between skills. relationship_type is deliberately an open VARCHAR, not a
-- fixed enum, so a future phase can introduce new relationship types without a migration -
-- Phase 1 populates PARENT_OF (domain/category hierarchy, mechanically derived - see
-- seedCategoryHierarchy), FRAMEWORK_OF (hand-verified "framework built on language" facts),
-- RELATED_TO (hand-curated "known alternatives in the same space", e.g. React/Vue.js/Angular),
-- USES (a small number of well-established tool-dependency facts, e.g. Kubernetes USES Docker),
-- and COMMONLY_WITH (real co-occurrence computed from this database's own candidate/job skill
-- data, weight = actual co-occurrence ratio, not fabricated). RUNS_ON and DATABASE_FOR are
-- supported by this schema but intentionally NOT populated in Phase 1 - the current skills
-- dictionary does not contain data precise enough to state either relationship as fact without
-- guessing (e.g. no single "the" database for an ORM that supports several) - see the Phase 1
-- report for the full reasoning; adding verified entries later requires no schema change.
CREATE TABLE IF NOT EXISTS skill_edges (
  id                  SERIAL PRIMARY KEY,
  from_skill_id       INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  to_skill_id         INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  relationship_type   VARCHAR(30) NOT NULL,
  weight              NUMERIC NOT NULL DEFAULT 1.0,
  -- 'curated' (PARENT_OF/FRAMEWORK_OF/RELATED_TO/USES, hand-verified) vs
  -- 'computed_cooccurrence' (COMMONLY_WITH, derived from real platform data).
  source              VARCHAR(30) NOT NULL DEFAULT 'curated',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_edges_unique_triple UNIQUE (from_skill_id, to_skill_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_skill_edges_from ON skill_edges(from_skill_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_skill_edges_to ON skill_edges(to_skill_id, relationship_type);

-- ============================================================================
-- 2. Role Intelligence Platform
-- ============================================================================

-- One row per role archetype. role_key is a stable slug (e.g. 'genai_engineer') so future roles
-- are a data insert, not a schema change - upsertRoleProfile() in
-- src/matching/roleIntelligence.ts is the single, reusable seeding entry point for both the
-- initial 9 roles this phase seeds and any future addition.
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
  -- Same plain-array embedding pattern as candidates.resume_embedding/jobs.description_embedding
  -- (pgvector is not available on this Postgres instance - see migration-pgvector-embeddings.sql).
  embedding                 DOUBLE PRECISION[],
  source                    VARCHAR(30) NOT NULL DEFAULT 'seed',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_profiles_role_key_key UNIQUE (role_key)
);

-- ============================================================================
-- 3. Confidence Architecture (candidates only - jobs already have parse_confidence JSONB,
--    populated by the existing JD parser's per-field tier tracking - see
--    src/jd-parser/types.ts's FieldSource / job.routes.ts's parse_confidence pass-through. That
--    is real, already-wired JD-side confidence infrastructure; this phase does not duplicate it.
--    Nothing on the resume/candidate side has ever recorded more than one whole-document
--    ai_confidence_score - that is the actual gap this column closes.)
-- ============================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS confidence_profile JSONB;

-- ============================================================================
-- 4. Multi-facet embeddings - additive, parallel to the existing whole-document
--    resume_embedding/description_embedding columns, which are untouched and still what
--    src/services.ts reads for matching. Populated by src/matching/embeddingIndex.ts
--    (extended, not replaced) using the SAME embedding model/service already in production
--    (all-MiniLM-L6-v2 via python-services/matching-ml-service) - just called with different text
--    slices (skills list / responsibilities text / title text) instead of the whole document.
-- ============================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills_embedding DOUBLE PRECISION[];
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS responsibilities_embedding DOUBLE PRECISION[];
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS title_embedding DOUBLE PRECISION[];

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills_embedding DOUBLE PRECISION[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS responsibilities_embedding DOUBLE PRECISION[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_embedding DOUBLE PRECISION[];
