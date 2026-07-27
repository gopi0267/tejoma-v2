-- Candidate Onboarding Enhancement (Naukri-inspired 6-step wizard). Additive only:
--   1) structured (single-entry) education columns on candidate_accounts
--   2) primary_skill / secondary_skills columns on candidate_accounts (Technical Skills and
--      Tools & Technologies reuse the existing skills[]/tools[] columns from Phase 7)
--   3) a new candidate_experiences child table for "Add Experience" multi-company support
-- No existing table structure changed; no existing row touched.
BEGIN;

ALTER TABLE candidate_accounts
  ADD COLUMN IF NOT EXISTS course_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS course_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS specialization VARCHAR(255),
  ADD COLUMN IF NOT EXISTS institution_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS start_year VARCHAR(10),
  ADD COLUMN IF NOT EXISTS end_year VARCHAR(10),
  ADD COLUMN IF NOT EXISTS grading_system VARCHAR(50),
  ADD COLUMN IF NOT EXISTS grade_value VARCHAR(50),
  ADD COLUMN IF NOT EXISTS primary_skill TEXT,
  ADD COLUMN IF NOT EXISTS secondary_skills TEXT[];

CREATE TABLE IF NOT EXISTS candidate_experiences (
  id                       SERIAL PRIMARY KEY,
  candidate_account_id     INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_title                VARCHAR(255),
  company                  VARCHAR(255),
  employment_type          VARCHAR(50), -- Full Time / Part Time / Contract / Internship / Freelance
  experience_years         INTEGER,
  experience_months        INTEGER,
  current_ctc              VARCHAR(100),
  expected_ctc             VARCHAR(100),
  notice_period             VARCHAR(100),
  current_location         VARCHAR(255),
  preferred_location       VARCHAR(255),
  key_responsibilities     TEXT,
  skills_used              TEXT[],
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_experiences_account ON candidate_experiences(candidate_account_id);

COMMIT;
