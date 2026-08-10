-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own role_profiles/career_trajectories tables are never touched by this migration
-- or its rollback - the monolith remains fully authoritative throughout.

BEGIN;

DROP TABLE IF EXISTS career_trajectories;
DROP TABLE IF EXISTS role_profiles;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
