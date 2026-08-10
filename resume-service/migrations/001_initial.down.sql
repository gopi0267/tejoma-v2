-- Rollback resume service initial schema

BEGIN;

DROP TABLE IF EXISTS resume_service.schema_migrations CASCADE;
DROP TABLE IF EXISTS resume_service.resume_extraction_jobs CASCADE;
DROP TABLE IF EXISTS resume_service.resumes CASCADE;
DROP SCHEMA IF EXISTS resume_service CASCADE;

COMMIT;
