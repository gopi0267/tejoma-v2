-- Rollback: Remove columns added for candidate decisions migration

BEGIN;

DROP INDEX IF EXISTS idx_candidate_decisions_timestamp;
DROP INDEX IF EXISTS idx_candidate_decisions_job_id;
DROP INDEX IF EXISTS idx_candidate_decisions_candidate_account_id;

ALTER TABLE candidate_decisions
  DROP COLUMN IF EXISTS candidate_account_id,
  DROP COLUMN IF EXISTS action,
  DROP COLUMN IF EXISTS timestamp;

DELETE FROM schema_migrations WHERE version = '005_decisions_schema';

COMMIT;
