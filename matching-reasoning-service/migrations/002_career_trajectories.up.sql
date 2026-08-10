-- Phase D Item 3: Career Trajectories table migration
-- Matching Reasoning Service now owns career_trajectories (Batch 32)
-- This table holds computed career trajectory analysis for each candidate
-- sourced directly from the monolith's schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS career_trajectories (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL,
  company_id            INTEGER NOT NULL,
  job_sequence          JSONB NOT NULL,
  total_career_months   INTEGER,
  role_count            INTEGER,
  progression_type      VARCHAR(20),
  seniority_level       VARCHAR(20),
  seniority_trend       VARCHAR(20),
  transitions           JSONB,
  avg_tenure_months     NUMERIC,
  median_tenure_months  NUMERIC,
  tenure_pattern        VARCHAR(20),
  gaps                  JSONB,
  domain_concentration  NUMERIC,
  domains               JSONB,
  trajectory_embedding  DOUBLE PRECISION[],
  predicted_next_roles  JSONB,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT career_trajectories_candidate_unique UNIQUE (candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_career_trajectories_candidate ON career_trajectories(candidate_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_company ON career_trajectories(company_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_seniority ON career_trajectories(seniority_level);

INSERT INTO schema_migrations (version) VALUES ('002_career_trajectories')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
