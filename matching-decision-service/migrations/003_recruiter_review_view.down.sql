-- Rollback: Drop recruiter_review_view table and indexes

BEGIN;

DROP TABLE IF EXISTS recruiter_review_view CASCADE;
DROP INDEX IF EXISTS idx_recruiter_review_view_company_id;
DROP INDEX IF EXISTS idx_recruiter_review_view_action;
DROP INDEX IF EXISTS idx_recruiter_review_view_decision_date;
DROP INDEX IF EXISTS idx_recruiter_review_view_match_score;
DROP INDEX IF EXISTS idx_recruiter_review_view_recruiter_name;
DROP INDEX IF EXISTS idx_recruiter_review_view_candidate_name;
DROP INDEX IF EXISTS idx_recruiter_review_view_search_trgm;

DELETE FROM schema_migrations WHERE version = '003_recruiter_review_view';

COMMIT;
