-- Candidate Service - Remaining-monolith migration, Step 5 - adds saved_candidates and
-- candidate_profile_views.
--
-- Owns (Step 5 domain audit): candidate-search.routes.ts, the recruiter-facing candidate search /
-- talent database feature, folds in here rather than into candidate-core-service (the plan's
-- original guess) because the table it searches - candidate_accounts - is already owned by THIS
-- service (Batch 16), not candidate-core-service's `candidates` table (a structurally different
-- entity: recruiter-uploaded resumes, not self-service candidate accounts). Confirmed by real
-- inspection of candidate-search.routes.ts's own queries, not assumed from the plan document.
--
-- candidate_account_id keeps a REAL foreign key here (candidate_accounts lives in this same
-- database) - same precedent as 002_notifications.up.sql's candidate_notifications table.
--
-- recruiter_user_id and company_id have NO foreign keys here, for the usual reason: the monolith's
-- schema.sql has both REFERENCES users(id)/companies(id), but neither table belongs to this
-- service - identity-service and tenant-directory-service own them respectively. Both remain plain
-- scoping columns (still indexed, still used in every query exactly as before) - the same
-- cross-service-FK-elimination pattern already applied to candidate_decisions/mutual_matches
-- (Batch 16) and recruiter_notifications' three dropped FKs (Batch 19).
--
-- Unlike every other service's own migrations in this remaining-monolith migration, these two
-- tables are NOT a dual-written mirror of a monolith table that keeps receiving parallel writes -
-- candidate-search.routes.ts's own feature (the only reader/writer of saved_candidates/
-- candidate_profile_views) is folding into this service outright, so this service becomes the sole
-- owner from this migration forward. The monolith's own two rows (0 saved_candidates, 1
-- candidate_profile_views row, confirmed via direct inspection before this migration was written)
-- were carried over by a one-time backfill script, not an ongoing dual-write hook.
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS saved_candidates (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL,
  company_id             INTEGER NOT NULL,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saved_candidates_unique UNIQUE (recruiter_user_id, candidate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_candidates_recruiter ON saved_candidates(recruiter_user_id);

CREATE TABLE IF NOT EXISTS candidate_profile_views (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL,
  company_id             INTEGER NOT NULL,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  viewed_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT candidate_profile_views_unique UNIQUE (recruiter_user_id, candidate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_profile_views_recruiter ON candidate_profile_views(recruiter_user_id, viewed_at DESC);

INSERT INTO schema_migrations (version) VALUES ('003_candidate_search')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
