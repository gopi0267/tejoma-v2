-- Candidate Service Analytics Mirror Schema
-- Phase 4, Item 4: Candidate Analytics Extraction
--
-- Mirrors 3 tables from monolith for candidate-analytics computation:
-- - candidate_decisions (recruiter decisions on candidates)
-- - candidate_application_status (application progress tracking)
-- - mutual_matches (candidate-job mutual interest records)
--
-- These tables are not new; they exist in the monolith.
-- We mirror them here for fast local analytics queries.
-- Cross-service FKs are dropped (scoped by company_id instead).

BEGIN;

-- Table 1: candidate_decisions
-- Tracks recruiter decisions about candidates
CREATE TABLE IF NOT EXISTS candidate_decisions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  recruiter_id INTEGER,
  decision_type VARCHAR(50), -- 'interview', 'offer', 'rejection', 'pending'
  decision_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_candidate_decisions_company_id ON candidate_decisions(company_id);
CREATE INDEX idx_candidate_decisions_candidate_id ON candidate_decisions(candidate_id);
CREATE INDEX idx_candidate_decisions_created_at ON candidate_decisions(created_at DESC);

-- Table 2: candidate_application_status
-- Tracks application progress per candidate-job pair
CREATE TABLE IF NOT EXISTS candidate_application_status (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  status VARCHAR(50), -- 'applied', 'screening', 'interview', 'offer', 'hired', 'rejected'
  status_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_candidate_application_status_company_id ON candidate_application_status(company_id);
CREATE INDEX idx_candidate_application_status_candidate_id ON candidate_application_status(candidate_id);
CREATE INDEX idx_candidate_application_status_job_id ON candidate_application_status(job_id);
CREATE INDEX idx_candidate_application_status_created_at ON candidate_application_status(created_at DESC);

-- Table 3: mutual_matches
-- Tracks when candidate and job mutually indicate interest
CREATE TABLE IF NOT EXISTS mutual_matches (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  candidate_interested BOOLEAN DEFAULT FALSE,
  job_interested BOOLEAN DEFAULT FALSE,
  matched_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mutual_matches_company_id ON mutual_matches(company_id);
CREATE INDEX idx_mutual_matches_candidate_id ON mutual_matches(candidate_id);
CREATE INDEX idx_mutual_matches_job_id ON mutual_matches(job_id);
CREATE INDEX idx_mutual_matches_matched_at ON mutual_matches(matched_at DESC);

-- Track migration
INSERT INTO schema_migrations (version) VALUES ('004_analytics_mirror') ON CONFLICT DO NOTHING;

COMMIT;
