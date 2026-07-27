-- NOT APPLIED. Prepared for review - drops the 5 tables confirmed orphaned across two hardening
-- passes: zero references anywhere in src/ or scripts/ (re-verified this pass with a fresh
-- grep, not just trusted from Phase 1), and each independently confirmed safe by structure:
--
--   recruiters       - an early users-table prototype (name/email/password_hash/company_id/
--                       role/verified), superseded by the current, richer `users` table
--                       (phone, soft-delete, audit trail columns). 0 rows.
--   password_reset   - an early password-reset-token table, superseded by the current
--                       OTP-based reset flow (otp_verification). 0 rows.
--   candidates_embedding_backup_pre_backfill  - a one-time pre-migration snapshot (17 rows),
--                       now stale relative to the live candidates table (35 rows) - restoring
--                       from it today would DELETE 18 real, current candidates, not protect them.
--   jobs_embedding_backup_pre_backfill        - same pattern (6 rows, live table also 6 but
--                       individually stale - not a safe restore point either way).
--   swipes_backup_pre_numeric_migration       - same pattern (76 rows vs 108 live).
--
-- The three backup tables have already fully served their original purpose (a safety net during
-- their respective migrations, both completed successfully long ago) and, being stale, no longer
-- function as a safety net even in principle - keeping them provides no protection, only clutter.
--
-- Run with: node run-migration.mjs migration-drop-orphaned-tables.sql
-- (only after you've confirmed you want this - table drops are irreversible without a separate
-- backup taken beforehand.)
BEGIN;

DROP TABLE IF EXISTS recruiters;
DROP TABLE IF EXISTS password_reset;
DROP TABLE IF EXISTS candidates_embedding_backup_pre_backfill;
DROP TABLE IF EXISTS jobs_embedding_backup_pre_backfill;
DROP TABLE IF EXISTS swipes_backup_pre_numeric_migration;

COMMIT;
