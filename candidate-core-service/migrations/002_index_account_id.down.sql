-- Rollback: Drop index on candidate_account_id

BEGIN;

DROP INDEX IF EXISTS idx_candidates_account_id;

DELETE FROM schema_migrations WHERE version = '002_index_account_id';

COMMIT;
