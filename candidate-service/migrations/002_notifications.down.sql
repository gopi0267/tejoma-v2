-- Rollback for 002_notifications. Destructive - only ever run with --confirm
-- (scripts/migrate.ts). The monolith's own candidate_notifications table is never touched by this
-- migration or its rollback - it remains fully authoritative throughout, per this migration's
-- strangler-fig discipline.

BEGIN;

DROP TABLE IF EXISTS candidate_notifications;
DELETE FROM schema_migrations WHERE version = '002_notifications';

COMMIT;
