-- Analytics Hub production fixes: adds decision-timing capture to swipes.
-- Additive only, nullable, no backfill - existing swipes report NULL ("N/A" in the API)
-- until new swipes recorded through the (now timing-aware) SwipeInterface populate it.

ALTER TABLE swipes ADD COLUMN IF NOT EXISTS decision_time_seconds NUMERIC;
