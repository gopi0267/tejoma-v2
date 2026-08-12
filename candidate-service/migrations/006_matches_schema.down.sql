DROP INDEX IF EXISTS idx_mutual_matches_account_matched_at;
DROP INDEX IF EXISTS idx_mutual_matches_candidate_account_id;
ALTER TABLE mutual_matches DROP COLUMN IF EXISTS candidate_account_id;
