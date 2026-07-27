-- Phase 6: first-login onboarding wizard gating. One nullable column, no other table touched.
-- NULL = wizard not yet completed (shown once, right after registration). Existing rows are
-- backfilled to their own created_at so accounts from Phases 1-5 testing never see an
-- unexpected wizard on next login.
BEGIN;

ALTER TABLE candidate_accounts ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;

UPDATE candidate_accounts SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;

COMMIT;
