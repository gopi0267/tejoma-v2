-- Rollback for analytics mirror tables

BEGIN;

DROP TABLE IF EXISTS mutual_matches CASCADE;
DROP TABLE IF EXISTS candidate_application_status CASCADE;
DROP TABLE IF EXISTS candidate_decisions CASCADE;

DELETE FROM schema_migrations WHERE version = '004_analytics_mirror';

COMMIT;
