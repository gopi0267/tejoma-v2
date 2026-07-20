-- swipes.action was declared INTEGER (migration-31-cols.sql), but application code (Recruiter
-- Review's "Saved" status, SwipeInterface's "Save for later" gesture, and this session's
-- shortlist-workflow fix) has always relied on action=0.5 as a third valid state. An INTEGER
-- column silently rejects 0.5 inserts, so "Saved" has never actually persisted. Widen to
-- NUMERIC(3,1) - existing 0/1 rows cast losslessly, 0.5 becomes storable.
BEGIN;

ALTER TABLE swipes ALTER COLUMN action TYPE NUMERIC(3,1) USING action::numeric(3,1);

COMMIT;
