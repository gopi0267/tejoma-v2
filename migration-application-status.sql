-- Phase 5: candidate application lifecycle tracking, sourced from the recruiter's EXISTING
-- decision workflow (swipes / PATCH /recruiter-review/:id/decision) - no new recruiter-facing
-- write path, no duplicate review system.
BEGIN;

CREATE TABLE IF NOT EXISTS candidate_application_status (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status                 VARCHAR(30) NOT NULL DEFAULT 'applied'
                           CHECK (status IN ('applied', 'under_review', 'shortlisted', 'rejected', 'accepted')),
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT candidate_application_status_key UNIQUE (candidate_account_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_application_status_candidate ON candidate_application_status(candidate_account_id);
CREATE INDEX IF NOT EXISTS idx_candidate_application_status_company_job ON candidate_application_status(company_id, job_id);

-- Widen Phase 4's candidate_notifications (additive, backward-compatible) so an
-- application-status-change notification can be represented without a mutual_matches row -
-- existing match_created rows are unaffected (their match_id stays set as before).
ALTER TABLE candidate_notifications ALTER COLUMN match_id DROP NOT NULL;
ALTER TABLE candidate_notifications ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE;

COMMIT;
