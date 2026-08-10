-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own skill_nodes/skill_edges/reasoning_conclusions tables are never touched by
-- this migration or its rollback - the monolith remains fully authoritative throughout.

BEGIN;

DROP TABLE IF EXISTS reasoning_conclusions;
DROP TABLE IF EXISTS skill_edges;
DROP TABLE IF EXISTS skill_nodes;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
