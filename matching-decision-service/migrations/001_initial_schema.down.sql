BEGIN;

DROP TABLE IF EXISTS detailed_scoring_reports;
DROP TABLE IF EXISTS recruiter_notes;
DROP TABLE IF EXISTS swipes;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
