-- mutual_matches arrived from 004_analytics_mirror, whose column set was designed around the
-- recruiter-side analytics concept: company_id + candidate_id, where candidate_id means a
-- candidate-core `candidates` row. The candidate-facing read path needs the other key - the
-- candidate_accounts id the monolith's own mutual_matches table is keyed by
-- (candidate_account_id) - which the mirror never had a column for, so
-- GET /api/candidate-matches could not be answered from this database at all.
--
-- Same shape of fix as 005_decisions_schema, which added candidate_account_id/job_id/action/
-- timestamp to candidate_decisions for exactly the same reason. Additive only: the existing
-- analytics columns are left untouched so anything reading them keeps working.

ALTER TABLE mutual_matches ADD COLUMN IF NOT EXISTS candidate_account_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_mutual_matches_candidate_account_id
  ON mutual_matches (candidate_account_id);

-- Supports the ORDER BY matched_at DESC NULLS LAST, created_at DESC read in db.ts.
CREATE INDEX IF NOT EXISTS idx_mutual_matches_account_matched_at
  ON mutual_matches (candidate_account_id, matched_at DESC);

-- 004_analytics_mirror declared candidate_id NOT NULL on both tables because, in the recruiter
-- analytics concept it was written for, every row is keyed by a candidate-core `candidates` id.
-- Candidate-facing rows have no such id - the monolith's own candidate_decisions/mutual_matches
-- are keyed by candidate_account_id - so those rows cannot satisfy the constraint and the
-- backfill aborted on the first row.
--
-- Dropping NOT NULL rather than inventing a candidate_id: fabricating an id to satisfy a
-- constraint would put wrong data in a column other readers trust. The column stays for the
-- analytics dual-write path that does populate it; it is simply optional now, because the table
-- legitimately holds rows from two sources that key differently.
ALTER TABLE candidate_decisions ALTER COLUMN candidate_id DROP NOT NULL;
ALTER TABLE mutual_matches      ALTER COLUMN candidate_id DROP NOT NULL;

-- Same reasoning for company_id: the monolith's candidate_decisions carries no company_id at all
-- (it is derived from the job), so a row whose job has since been removed cannot supply one.
ALTER TABLE candidate_decisions ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE mutual_matches      ALTER COLUMN company_id DROP NOT NULL;
