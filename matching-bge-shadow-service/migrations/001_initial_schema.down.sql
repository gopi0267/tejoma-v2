-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own bge_retrieval_shadow_comparisons table is never touched by this migration or
-- its rollback - it remains intact (though no longer written to once cutover happens).

BEGIN;

DROP TABLE IF EXISTS bge_retrieval_shadow_comparisons;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
