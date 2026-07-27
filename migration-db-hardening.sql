-- Production Database Hardening pass. Additive / corrective only:
--   - no existing table dropped, no existing column removed or retyped
--   - no application-visible API response shape changed by this migration
--   - every fix below is inert against current application behavior (verified: the code paths
--     affected either have no call sites today, or the changed condition - a company being
--     hard-deleted - never occurs anywhere in the app), so this is safe to apply against a live
--     database with existing data.
-- See the accompanying hardening report for full before/after rationale on each change.
BEGIN;

-- ============================================================================
-- 1. daily_stats: add the UNIQUE(recruiter_id, date) constraint db.ts's updateDailyStats() has
-- always assumed via `INSERT ... ON CONFLICT (recruiter_id, date) DO UPDATE` - the live table
-- never actually had it, so that exact code path would throw "no unique or exclusion constraint
-- matching the ON CONFLICT specification" if it ever ran. Currently inert: updateDailyStats() and
-- getDailyStats() have zero call sites anywhere in src/api/. This unblocks the feature for
-- whenever it's wired up, without changing anything reachable today.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE daily_stats ADD CONSTRAINT daily_stats_recruiter_date_unique UNIQUE (recruiter_id, date);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- 2. Standardize ON DELETE behavior for company_id foreign keys. 7 of 10 company_id FKs already
-- cascade (jobs, recruiter_notes, recruiter_notifications, knowledge_base_chunks,
-- candidate_application_status, saved_candidates, candidate_profile_views, mutual_matches).
-- candidates/swipes/match_scores were left as NO ACTION - the three oldest company_id FKs in the
-- schema, predating the CASCADE convention every later one adopted. No application code path
-- deletes a company today (confirmed: no DELETE FROM companies anywhere in src/db.ts), so this
-- only changes behavior in a currently-unreachable case; it removes a real footgun for whenever
-- company deletion/offboarding is added, where today it would cascade-clean most of a company's
-- data but then hard-fail on any remaining candidates/swipes/match_scores rows.
-- ============================================================================
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_company_id_fkey;
ALTER TABLE candidates ADD CONSTRAINT candidates_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE swipes DROP CONSTRAINT IF EXISTS swipes_company_id_fkey;
ALTER TABLE swipes ADD CONSTRAINT swipes_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

ALTER TABLE match_scores DROP CONSTRAINT IF EXISTS match_scores_company_id_fkey;
ALTER TABLE match_scores ADD CONSTRAINT match_scores_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;


-- ============================================================================
-- 3. Remove genuinely redundant indexes. candidate_accounts already has a UNIQUE constraint (and
-- its backing index) on email and phone; idx_candidate_accounts_email/_phone are separate,
-- non-unique indexes on the exact same single column - Postgres always prefers the unique index
-- for equality lookups, so these provide zero additional query-planning benefit while still
-- costing write overhead and disk on every insert/update.
-- ============================================================================
DROP INDEX IF EXISTS idx_candidate_accounts_email;
DROP INDEX IF EXISTS idx_candidate_accounts_phone;


-- ============================================================================
-- 4. Missing indexes supporting queries the application already runs today, with no query-code
-- change required to benefit from them.
-- ============================================================================
-- candidates.email: no index existed on this table beyond company_id - used for lookup/dedupe
-- during manual add and bulk import (candidate.routes.ts).
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);

-- swipes.job_id / match_scores.job_id: neither table had any index (or FK) on job_id alone,
-- despite "every swipe/score for this job" being a natural access pattern once a job's full
-- decision history needs to be queried directly rather than joined through candidates.
CREATE INDEX IF NOT EXISTS idx_swipes_job_id ON swipes(job_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_job_id ON match_scores(job_id);


-- ============================================================================
-- 5. Candidate search (db.searchCandidateAccounts, backing Candidate Search / talent pipeline
-- tabs) filters on ILIKE '%term%' across 5 text columns and array-overlap (&&) across 4 array
-- columns, with no index able to support either pattern today - every one of those filters forces
-- a full sequential scan of candidate_accounts regardless of company size. pg_trgm trigram
-- indexes support ILIKE; GIN indexes support &&. pg_trgm is a standard, near-universally
-- available Postgres extension (bundled with contrib, allow-listed on RDS/Cloud SQL/Supabase/
-- Neon/etc.) - not a new external dependency.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_candidate_accounts_name_trgm ON candidate_accounts USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_headline_trgm ON candidate_accounts USING GIN (headline gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_location_trgm ON candidate_accounts USING GIN (location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_company_trgm ON candidate_accounts USING GIN (current_company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_summary_trgm ON candidate_accounts USING GIN (summary gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_candidate_accounts_skills_gin ON candidate_accounts USING GIN (skills);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_certifications_gin ON candidate_accounts USING GIN (certifications);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_tools_gin ON candidate_accounts USING GIN (tools);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_languages_gin ON candidate_accounts USING GIN (languages);

-- Partial index matching CANDIDATE_SEARCH_BASE_WHERE (visible_to_recruiters/is_active/
-- deleted_at/onboarding_completed_at) plus the `ORDER BY updated_at DESC` every candidate-search
-- query uses - covers the single most common filter+sort combination directly, so the base case
-- (no extra filters, first page, most-recently-updated first) is an index-only scan instead of a
-- sequential scan even before any of the trigram/GIN indexes above come into play.
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_searchable_updated
  ON candidate_accounts (updated_at DESC)
  WHERE visible_to_recruiters = true AND is_active = true AND deleted_at IS NULL AND onboarding_completed_at IS NOT NULL;

COMMIT;
