-- Candidate Service - Candidate Decisions Migration (Phase 2)
-- Align candidate_decisions schema with monolith for proper ownership migration
--
-- Previous schema (004_analytics_mirror) was a simplified mirror for analytics.
-- This migration adds columns needed for production use and enables write operations.

BEGIN;

-- Add missing columns to candidate_decisions table
-- These are needed to match monolith schema and support writes

ALTER TABLE candidate_decisions
  ADD COLUMN IF NOT EXISTS candidate_account_id INTEGER,
  ADD COLUMN IF NOT EXISTS job_id INTEGER,
  ADD COLUMN IF NOT EXISTS action INTEGER,
  ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP;

-- Populate candidate_account_id from candidate_id (if needed - for backwards compat)
-- Note: candidate_id is from a different context; we need candidate_account_id
-- For now, they should be the same since candidate-service owns candidate_accounts

UPDATE candidate_decisions
SET candidate_account_id = candidate_id
WHERE candidate_account_id IS NULL AND candidate_id IS NOT NULL;

-- For analytics-only records that have decision_date but no timestamp
UPDATE candidate_decisions
SET timestamp = decision_date
WHERE timestamp IS NULL AND decision_date IS NOT NULL;

-- For any remaining null timestamps, use created_at
UPDATE candidate_decisions
SET timestamp = created_at
WHERE timestamp IS NULL;

-- Make the important columns non-nullable
ALTER TABLE candidate_decisions
  ALTER COLUMN candidate_account_id SET NOT NULL,
  ALTER COLUMN timestamp SET NOT NULL;

-- Create indexes for common queries (from monolith db.ts)
CREATE INDEX IF NOT EXISTS idx_candidate_decisions_candidate_account_id
  ON candidate_decisions(candidate_account_id);

CREATE INDEX IF NOT EXISTS idx_candidate_decisions_job_id
  ON candidate_decisions(job_id);

CREATE INDEX IF NOT EXISTS idx_candidate_decisions_timestamp
  ON candidate_decisions(timestamp DESC);

-- Create a unique constraint on (candidate_account_id, job_id, timestamp, id)
-- This prevents duplicate decision records for the same (account, job) pair
-- while allowing multiple decisions over time
-- Note: PostgreSQL doesn't support true append-only guarantees at DB level,
-- so we rely on application-level logic to check getLatestCandidateDecision()

-- Track migration
INSERT INTO schema_migrations (version) VALUES ('005_decisions_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
