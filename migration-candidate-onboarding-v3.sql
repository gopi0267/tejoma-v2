-- Candidate Portal Onboarding Enhancement: 4 new columns on candidate_accounts, required to
-- support fields the new onboarding flow's spec explicitly asks for that had no existing home:
-- Current Designation (distinct from the existing `headline` tagline field), Projects (freeform,
-- matching the raw `candidates` table's own `projects TEXT` convention), LinkedIn, and GitHub.
-- Additive only - no existing column changed, no existing row touched.
BEGIN;

ALTER TABLE candidate_accounts
  ADD COLUMN IF NOT EXISTS current_job_title VARCHAR(255),
  ADD COLUMN IF NOT EXISTS projects TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255),
  ADD COLUMN IF NOT EXISTS github_url VARCHAR(255);

COMMIT;
