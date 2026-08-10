-- Rollback for 001_initial_schema. Drops both tables this service owns - destructive, only ever
-- run with --confirm (scripts/migrate.ts), and only meaningful before real candidate traffic
-- depends on this database (the monolith's own candidate_accounts/candidate_experiences tables
-- are never touched by this migration or its rollback - they remain fully authoritative
-- throughout, per this migration's strangler-fig discipline).

BEGIN;

DROP TABLE IF EXISTS candidate_experiences;
DROP TABLE IF EXISTS candidate_accounts;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
