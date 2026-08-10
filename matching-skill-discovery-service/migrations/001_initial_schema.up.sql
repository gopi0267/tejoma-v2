-- Matching Skill Discovery Service - Batch 27 - initial schema.
-- Owns (Batch 27 domain audit): skill_discovery_proposals - the Unknown Skill Discovery pipeline's
-- own output table (detect/classify/embed/propose over resume+JD tokens the existing skill
-- dictionary can't resolve). Also carries a dual-written, read-only-from-this-service's-own-code
-- mirror of skill_nodes - findNearestNeighbors/canonicalizeSkill both need to read the skill graph.
-- The monolith remains the sole writer of skill_nodes/skill_edges (skillIntelligence.ts's seeding,
-- unknownSkillDiscovery.ts's own promotion pipeline there) - this service's own promotion logic
-- proxies the actual write back to a new monolith /internal/skill-discovery/promote endpoint
-- rather than writing skill_nodes/skill_edges here directly (this service's db.ts upsertSkillNode
-- exists only as dual-write's target, exactly like matching-reasoning-service's copy).
--
-- skill_edges is NOT mirrored here - unknownSkillDiscovery.ts never reads skill_edges (only writes
-- new ones during promotion, which goes through the monolith proxy instead).
--
-- Cross-service FKs dropped on skill_discovery_proposals: proposed_related_skill_id and
-- promoted_skill_node_id referenced skill_nodes(id) in the monolith's own copy - skill_nodes here
-- is a mirror, not authoritative, so both become plain scoping integers (no FK). reviewed_by
-- referenced users(id) - Identity Service's table, also dropped, same cross-service-FK-elimination
-- pattern used throughout this migration.
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

CREATE TABLE IF NOT EXISTS skill_discovery_proposals (
  id                          SERIAL PRIMARY KEY,
  raw_token                   VARCHAR(150) NOT NULL,
  normalized_token            VARCHAR(150) NOT NULL,
  source_type                 VARCHAR(10) NOT NULL CHECK (source_type IN ('resume', 'jd')),
  context_text                TEXT,
  mention_count               INTEGER NOT NULL DEFAULT 1,
  is_skill                    BOOLEAN,
  proposed_category           VARCHAR(40),
  nearest_neighbors           JSONB,
  proposed_relationship_type  VARCHAR(30),
  proposed_related_skill_id   INTEGER,
  confidence                  NUMERIC,
  status                      VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'auto_promoted', 'approved', 'rejected', 'not_a_skill')),
  promoted_skill_node_id       INTEGER,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at                 TIMESTAMP,
  reviewed_by                 INTEGER,
  CONSTRAINT skill_discovery_proposals_token_unique UNIQUE (normalized_token)
);
CREATE INDEX IF NOT EXISTS idx_skill_discovery_proposals_status ON skill_discovery_proposals(status, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
