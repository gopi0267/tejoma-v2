-- Rollback for 001_initial_schema. Destructive - only ever run with --confirm (scripts/migrate.ts).
-- The monolith's own knowledge_base_chunks table is never touched by this migration or its
-- rollback - it remains fully authoritative throughout, per this migration's strangler-fig
-- discipline.

BEGIN;

DROP TABLE IF EXISTS knowledge_base_chunks;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
