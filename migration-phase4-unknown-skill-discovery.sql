-- Phase 4 (Unknown Skill Discovery, architecture doc §5) of the Enterprise AI Matching
-- Architecture. Purely additive: one new column, one new table. Nothing existing is dropped,
-- retyped, or renamed. Safe to run multiple times (IF NOT EXISTS throughout).
--
-- SCOPE NOTE: this phase implements §5 only. §2.1-2.4 (Skill Proficiency, Skill Recency &
-- Evolution, Project Intelligence Graph, Career Intelligence) are explicitly NOT started - they
-- depend on structured, dated per-role/per-project history that candidates.projects (a single
-- flat string) and the current parser do not produce. That is a separate, larger prerequisite,
-- not something this migration works around or fakes.

-- ============================================================================
-- 1. skill_nodes.embedding - additive column. Phase 1 gave role_profiles/candidates/jobs
-- embedding columns but never skill_nodes itself, which Unknown Skill Discovery's "semantic
-- understanding" stage (§5, pipeline stage 3) needs to find a new term's nearest neighbors
-- among already-known skills. Same plain-array pattern as every other embedding column in this
-- schema (pgvector still not installed - see migration-pgvector-embeddings.sql).
-- ============================================================================
ALTER TABLE skill_nodes ADD COLUMN IF NOT EXISTS embedding DOUBLE PRECISION[];

-- ============================================================================
-- 2. skill_discovery_proposals - one row per distinct unresolved token ever encountered
-- (UNIQUE on normalized_token - repeat sightings bump mention_count rather than creating
-- duplicate rows, so "confidence rising as more independent documents corroborate" - the
-- document's own stage-7 language - has something real to compute from). Append-mostly:
-- status transitions (pending -> auto_promoted/approved/rejected/not_a_skill) are the only
-- updates, matching this schema's existing audit-trail conventions elsewhere.
-- ============================================================================
CREATE TABLE IF NOT EXISTS skill_discovery_proposals (
  id                          SERIAL PRIMARY KEY,
  raw_token                   VARCHAR(150) NOT NULL,
  normalized_token            VARCHAR(150) NOT NULL,
  source_type                 VARCHAR(10) NOT NULL CHECK (source_type IN ('resume', 'jd')),
  context_text                TEXT,
  mention_count               INTEGER NOT NULL DEFAULT 1,
  -- Classification stage (§5 pipeline stage 2) - null until classified, then fixed; a token
  -- classified 'not a skill' is never reclassified on repeat sightings (see module doc).
  is_skill                    BOOLEAN,
  proposed_category           VARCHAR(40),
  -- Semantic understanding + relationship discovery (§5 pipeline stages 3-4).
  nearest_neighbors           JSONB,
  proposed_relationship_type  VARCHAR(30),
  proposed_related_skill_id   INTEGER REFERENCES skill_nodes(id) ON DELETE SET NULL,
  -- Derived from concrete signals (top neighbor similarity + corroborating mention count) -
  -- never from an LLM's own self-reported confidence number, same discipline the Confidence
  -- Architecture (Phase 1) already applies to skill proficiency claims.
  confidence                  NUMERIC,
  status                      VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'auto_promoted', 'approved', 'rejected', 'not_a_skill')),
  promoted_skill_node_id       INTEGER REFERENCES skill_nodes(id) ON DELETE SET NULL,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at                 TIMESTAMP,
  reviewed_by                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT skill_discovery_proposals_token_unique UNIQUE (normalized_token)
);

CREATE INDEX IF NOT EXISTS idx_skill_discovery_proposals_status ON skill_discovery_proposals(status, created_at DESC);
