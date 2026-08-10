-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own live scoring computation is never touched by this migration or its rollback.

BEGIN;

DROP TABLE IF EXISTS scoring_computations;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
