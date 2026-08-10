-- Phase D Item 3: Rollback career trajectories table

BEGIN;

DROP TABLE IF EXISTS career_trajectories;

DELETE FROM schema_migrations WHERE version = '002_career_trajectories';

COMMIT;
