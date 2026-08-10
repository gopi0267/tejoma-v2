BEGIN;

DROP TABLE IF EXISTS jobs;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
