BEGIN;

DROP TABLE IF EXISTS company_registration_requests;
DROP TYPE IF EXISTS company_registration_status;

DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
