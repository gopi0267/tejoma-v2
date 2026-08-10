-- Rollback upload service initial schema

BEGIN;

DROP TABLE IF EXISTS uploads CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;

COMMIT;
