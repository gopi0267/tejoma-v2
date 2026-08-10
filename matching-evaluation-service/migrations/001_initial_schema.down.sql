-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own ltr_model_versions/match_evaluation_runs tables are never touched by this
-- migration or its rollback - they remain fully authoritative throughout, per this migration's
-- strangler-fig discipline.

BEGIN;

DROP TABLE IF EXISTS match_evaluation_runs;
DROP TABLE IF EXISTS ltr_model_versions;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
