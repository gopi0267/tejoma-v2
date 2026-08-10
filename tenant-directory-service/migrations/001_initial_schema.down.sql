BEGIN;

DROP TABLE IF EXISTS companies;
DROP TYPE IF EXISTS company_plan;

DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
