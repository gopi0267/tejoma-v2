-- Rollback for 002_shadow_scores. Destructive - only ever run with --confirm
-- (scripts/migrate.ts). The monolith's own proficiency_shadow_scores table is never touched by
-- this migration or its rollback - it remains fully authoritative throughout, per this
-- migration's strangler-fig discipline.

BEGIN;

DROP TABLE IF EXISTS proficiency_shadow_scores;
DELETE FROM schema_migrations WHERE version = '002_shadow_scores';

COMMIT;
