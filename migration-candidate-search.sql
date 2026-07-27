-- Phase 7: recruiter candidate search / talent database. All additive:
--   1) new nullable/defaulted search-facet + visibility columns on candidate_accounts
--   2) two new small tables (saved_candidates, candidate_profile_views) - no existing table
--      structure changed, no existing row touched beyond the two default-backfilled booleans.
BEGIN;

ALTER TABLE candidate_accounts
  ADD COLUMN IF NOT EXISTS current_company VARCHAR(255),
  ADD COLUMN IF NOT EXISTS certifications TEXT[],
  ADD COLUMN IF NOT EXISTS tools TEXT[],
  ADD COLUMN IF NOT EXISTS languages TEXT[],
  ADD COLUMN IF NOT EXISTS notice_period VARCHAR(100),
  ADD COLUMN IF NOT EXISTS current_ctc VARCHAR(100),
  ADD COLUMN IF NOT EXISTS expected_ctc VARCHAR(100),
  ADD COLUMN IF NOT EXISTS open_to_work BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_to_recruiters BOOLEAN DEFAULT true;

-- Backfill existing rows explicitly (DEFAULT only applies to new inserts on some PG versions'
-- ADD COLUMN semantics for pre-existing rows it's applied automatically, but being explicit here
-- keeps this migration self-documenting and safe to re-run).
UPDATE candidate_accounts SET open_to_work = true WHERE open_to_work IS NULL;
UPDATE candidate_accounts SET visible_to_recruiters = true WHERE visible_to_recruiters IS NULL;

CREATE TABLE IF NOT EXISTS saved_candidates (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saved_candidates_unique UNIQUE (recruiter_user_id, candidate_account_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_candidates_recruiter ON saved_candidates(recruiter_user_id);

CREATE TABLE IF NOT EXISTS candidate_profile_views (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  viewed_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT candidate_profile_views_unique UNIQUE (recruiter_user_id, candidate_account_id)
);
CREATE INDEX IF NOT EXISTS idx_candidate_profile_views_recruiter ON candidate_profile_views(recruiter_user_id, viewed_at DESC);

COMMIT;
