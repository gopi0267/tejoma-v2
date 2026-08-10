BEGIN;

DROP TABLE IF EXISTS candidates;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
