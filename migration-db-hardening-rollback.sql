-- Rollback for migration-db-hardening.sql. Exact inverse, in reverse order. Safe to run against
-- a database that has migration-db-hardening.sql applied; a no-op (via IF EXISTS) against one
-- that doesn't. Does not touch any table's data - only reverses constraint/index/extension
-- definitions.
--
-- Run with: node run-migration.mjs migration-db-hardening-rollback.sql
-- (or: psql -U <user> -d <db> -f migration-db-hardening-rollback.sql)
BEGIN;

-- ============================================================================
-- Reverse step 5: candidate search indexes + pg_trgm extension.
-- ============================================================================
DROP INDEX IF EXISTS idx_candidate_accounts_searchable_updated;
DROP INDEX IF EXISTS idx_candidate_accounts_languages_gin;
DROP INDEX IF EXISTS idx_candidate_accounts_tools_gin;
DROP INDEX IF EXISTS idx_candidate_accounts_certifications_gin;
DROP INDEX IF EXISTS idx_candidate_accounts_skills_gin;
DROP INDEX IF EXISTS idx_candidate_accounts_summary_trgm;
DROP INDEX IF EXISTS idx_candidate_accounts_company_trgm;
DROP INDEX IF EXISTS idx_candidate_accounts_location_trgm;
DROP INDEX IF EXISTS idx_candidate_accounts_headline_trgm;
DROP INDEX IF EXISTS idx_candidate_accounts_name_trgm;
-- Not dropping the pg_trgm EXTENSION itself: it's a shared, harmless, near-universally-available
-- Postgres extension - other indexes/future code could depend on it, and DROP EXTENSION would
-- fail loudly anyway if anything still does. Leaving it installed is inert.

-- ============================================================================
-- Reverse step 4: candidates.email / swipes.job_id / match_scores.job_id indexes.
-- ============================================================================
DROP INDEX IF EXISTS idx_match_scores_job_id;
DROP INDEX IF EXISTS idx_swipes_job_id;
DROP INDEX IF EXISTS idx_candidates_email;

-- ============================================================================
-- Reverse step 3: restore the two removed candidate_accounts indexes.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_email ON candidate_accounts(email);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_phone ON candidate_accounts(phone);

-- ============================================================================
-- Reverse step 2: restore ON DELETE NO ACTION on the three company_id FKs.
-- ============================================================================
ALTER TABLE match_scores DROP CONSTRAINT IF EXISTS match_scores_company_id_fkey;
ALTER TABLE match_scores ADD CONSTRAINT match_scores_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE swipes DROP CONSTRAINT IF EXISTS swipes_company_id_fkey;
ALTER TABLE swipes ADD CONSTRAINT swipes_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_company_id_fkey;
ALTER TABLE candidates ADD CONSTRAINT candidates_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES companies(id);

-- ============================================================================
-- Reverse step 1: drop the daily_stats unique constraint.
-- Safe: updateDailyStats()/getDailyStats() have no call sites anywhere in src/api/ today, so
-- nothing reads or writes through this constraint currently - dropping it is inert.
-- ============================================================================
ALTER TABLE daily_stats DROP CONSTRAINT IF EXISTS daily_stats_recruiter_date_unique;

COMMIT;
