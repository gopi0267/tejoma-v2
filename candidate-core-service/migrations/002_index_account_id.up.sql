-- Add index on candidate_account_id for Item 4 analytics cross-service lookups

BEGIN;

CREATE INDEX IF NOT EXISTS idx_candidates_account_id ON candidates(candidate_account_id);

INSERT INTO schema_migrations (version) VALUES ('002_index_account_id')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
