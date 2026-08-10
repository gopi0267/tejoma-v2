-- Rollback for 001_initial_schema. Drops only what that migration created, in reverse dependency
-- order (children before parents, to satisfy FK constraints without needing CASCADE).
--
-- SAFETY: this is destructive. Once Batch 4+ routes are live and real user data exists in these
-- tables, running this deletes it. scripts/migrate.ts requires an explicit --confirm flag before
-- executing any down migration for exactly this reason - see that script.

BEGIN;

DROP TABLE IF EXISTS otp_verification;
DROP TABLE IF EXISTS candidate_refresh_tokens;
DROP TABLE IF EXISTS candidate_accounts;
DROP TABLE IF EXISTS password_history;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

-- user_role is intentionally NOT dropped - a future migration may still depend on it, and
-- DROP TYPE would fail loudly if any column still references it, which is the correct, safe
-- failure mode rather than a silent partial rollback.

DELETE FROM schema_migrations WHERE version = '001_initial_schema';

COMMIT;
