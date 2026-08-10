-- Recruiter Review List CQRS materialized view (Remaining-monolith migration, Item 5)
--
-- Single denormalized table, one row per (candidate_id, job_id) pair, upserted in place.
-- Contains the exact columns needed by the getRecruiterReviewList filter/sort/paginate query
-- (see monolith src/db.ts:getRecruiterReviewList for the original SELECT list).
--
-- Populated via dual-write from matching-decision-service's own write paths (POST /swipes,
-- PATCH /:id/decision, POST /:id/notes) plus cross-service refresh hooks from candidate-core-service,
-- job-service, and identity-service on their respective write operations.
--
-- Indexes on every filter/sort column used in the original query (decision_date, action,
-- match_score, recruiter_name, candidate_name), plus a pg_trgm GIN index for the
-- multi-field full-text ILIKE search (candidate_name + skills + job_title).

BEGIN;

CREATE TABLE IF NOT EXISTS recruiter_review_view (
  -- Primary key: (candidate_id, job_id) uniquely identifies a pair
  candidate_id          INTEGER NOT NULL,
  job_id                INTEGER NOT NULL,
  company_id            INTEGER NOT NULL,

  -- Candidate data (denormalized)
  candidate_name        VARCHAR(255),
  candidate_email       VARCHAR(255),
  candidate_phone       VARCHAR(20),
  candidate_skills      VARCHAR,
  candidate_location    VARCHAR(255),
  candidate_years_exp   VARCHAR(50),
  candidate_company     VARCHAR(255),

  -- Job data (denormalized)
  job_title             VARCHAR(255),
  job_location          VARCHAR(255),
  job_company_name      VARCHAR(255),

  -- Recruiter data (denormalized)
  recruiter_name        VARCHAR(255),
  recruiter_id          INTEGER,

  -- Decision data (the swipe row)
  latest_action         NUMERIC,
  latest_decision_date  TIMESTAMP,
  match_score           NUMERIC,
  reason                VARCHAR(1000),

  -- Recruiter notes (from recruiter_notes table)
  note_text             VARCHAR(5000),

  -- Metadata
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (candidate_id, job_id)
);

-- Indexes for filter/sort operations
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_company_id ON recruiter_review_view(company_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_action ON recruiter_review_view(latest_action);
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_decision_date ON recruiter_review_view(latest_decision_date DESC);
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_match_score ON recruiter_review_view(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_recruiter_name ON recruiter_review_view(recruiter_name);
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_candidate_name ON recruiter_review_view(candidate_name);

-- pg_trgm GIN index for full-text ILIKE search across candidate_name, skills, job_title
-- Requires: CREATE EXTENSION pg_trgm if not already installed
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_recruiter_review_view_search_trgm
  ON recruiter_review_view USING GIN ((candidate_name || ' ' || candidate_skills || ' ' || job_title) gin_trgm_ops);

INSERT INTO schema_migrations (version) VALUES ('003_recruiter_review_view')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
