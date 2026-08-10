-- Matching Reasoning Service - Batch 26 - initial schema.
-- Owns (Batch 26 domain audit): the AI Reasoning Layer's own output table
-- (reasoning_conclusions), plus a dual-written, read-only-from-this-service's-own-code mirror of
-- skill_nodes/skill_edges - the graph the six ported reasoning modules traverse. The monolith
-- remains the sole writer of skill_nodes/skill_edges (skillIntelligence.ts's seeding,
-- unknownSkillDiscovery.ts's promotion pipeline); this service's own db.ts has upsert functions
-- for them only because they are the DUAL-WRITE TARGETS the monolith's dualWrite.ts calls, not
-- because this service's own reasoning logic ever writes to them.
--
-- Unlike every prior batch's cross-service tables, skill_edges.from_skill_id/to_skill_id KEEP
-- their real FK to skill_nodes(id) here - both tables are mirrored together into this same
-- database, so the FK is not cross-service the way company_id/candidate_id were in prior batches.
--
-- reasoning_conclusions has NO FK to skill_nodes/skill_edges (evidence_chain embeds skill names as
-- text, not foreign keys - same denormalized-evidence shape the monolith's own table uses) and no
-- FK to candidates/jobs (subject_type/subject_id is a polymorphic reference into monolith-owned
-- tables, exactly as it is in the monolith's own schema.sql).
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing invented.

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
CREATE INDEX IF NOT EXISTS idx_skill_edges_to ON skill_edges(to_skill_id, relationship_type);

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
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reasoning_conclusions_unique_triple UNIQUE (subject_type, subject_id, conclusion_text)
);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_subject ON reasoning_conclusions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_type ON reasoning_conclusions(reasoning_type);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
