-- Rollback for 002_resync_sequences. Deliberately a no-op beyond the schema_migrations bookkeeping
-- - there is no meaningful "previous sequence value" to restore to, and doing so would simply
-- reintroduce the exact primary-key-collision bug this migration fixed. If Phase C's own cutover
-- is ever rolled back (the service's own route handler reverting to proxy the monolith again, per
-- MIGRATION_RUNBOOK.md's own rollback convention for this phase), the sequence staying resynced is
-- harmless - the monolith's own explicit-id dual-writes will simply keep landing below it, exactly
-- as they always have.

BEGIN;

DELETE FROM schema_migrations WHERE version = '002_resync_sequences';

COMMIT;
