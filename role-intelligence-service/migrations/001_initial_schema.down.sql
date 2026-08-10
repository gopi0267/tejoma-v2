-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own role_profiles table is never touched by this migration or its rollback - it
-- remains fully authoritative throughout.

BEGIN;

DROP TABLE IF EXISTS role_profiles;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
