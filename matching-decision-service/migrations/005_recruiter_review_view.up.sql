-- Recruiter Review View - Materialized Read Model
-- Phase 4, Item 5: GET /api/recruiter-review (List) - CQRS
--
-- Denormalized view table for efficient recruiter review list queries
-- across 4 databases (candidates, jobs, recruiter names, swipes + notes).
--
-- One row per (candidate_id, job_id, company_id) — upserted in place.
-- Eliminates need for 5-table join at query time, fixes pagination correctness
-- at scale (monolith's LIMIT/OFFSET on 5-table join is unreliable).
--
-- Kept fresh via dual-write hooks on 4 owning services:
-- - candidate-core-service: candidate create/update/delete
-- - job-service: job create/update/delete
-- - identity-service: recruiter name/status changes
-- - matching-decision-service: swipe/note/decision writes (in-process)
--
-- Columns are denormalized: all fields needed for list query, no lookups.
-- Indexes cover every filter/sort combination in production use.
-- pg_trgm GIN index for ILIKE multi-field search (better than monolith's seq scan).

BEGIN;

CREATE TABLE IF NOT EXISTS recruiter_review_view (
  -- Keys
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,

  -- Candidate fields (denormalized)
  candidate_email VARCHAR(255),
  candidate_name VARCHAR(255),
  candidate_phone VARCHAR(20),
  candidate_skills TEXT[], -- array for easy skill matching
  candidate_experience_years NUMERIC,

  -- Job fields (denormalized)
  job_title VARCHAR(255),
  job_required_skills TEXT[],
  job_location VARCHAR(255),

  -- Recruiter fields (denormalized)
  recruiter_id INTEGER,
  recruiter_name VARCHAR(255),
  recruiter_email VARCHAR(255),

  -- Swipe + decision fields
  action INTEGER, -- 1 = interested, 0 = not interested
  score NUMERIC,
  reason TEXT,
  recruiter_note TEXT,

  -- Timing
  decision_date TIMESTAMP,
  swipe_created_at TIMESTAMP,
  swipe_updated_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint: one row per (candidate_id, job_id, company_id)
  UNIQUE(company_id, candidate_id, job_id)
);

-- Indexes for filter/sort/search combinations in production use
CREATE INDEX idx_recruiter_review_view_company_id ON recruiter_review_view(company_id);
CREATE INDEX idx_recruiter_review_view_company_created_desc ON recruiter_review_view(company_id, swipe_created_at DESC);
CREATE INDEX idx_recruiter_review_view_candidate_id ON recruiter_review_view(candidate_id);
CREATE INDEX idx_recruiter_review_view_job_id ON recruiter_review_view(job_id);
CREATE INDEX idx_recruiter_review_view_recruiter_id ON recruiter_review_view(recruiter_id);

-- Action filter (interested vs. not interested)
CREATE INDEX idx_recruiter_review_view_action ON recruiter_review_view(company_id, action);

-- Decision date sort + filter
CREATE INDEX idx_recruiter_review_view_decision_date ON recruiter_review_view(company_id, decision_date DESC NULLS LAST);

-- Score sort/filter
CREATE INDEX idx_recruiter_review_view_score ON recruiter_review_view(company_id, score DESC NULLS LAST);

-- Full-text search index (candidate name, email, job title, recruiter name)
-- Using pg_trgm for ILIKE queries (real production improvement over seq scan)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_recruiter_review_view_search_trgm
  ON recruiter_review_view USING GIN (
    (CONCAT_WS(' ', candidate_name, candidate_email, job_title, recruiter_name) || ''));

-- Track migration
INSERT INTO schema_migrations (version) VALUES ('005_recruiter_review_view') ON CONFLICT DO NOTHING;

COMMIT;
