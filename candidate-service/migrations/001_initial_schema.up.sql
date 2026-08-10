-- Candidate Service - Tier 0 (Batch 16) - initial schema.
-- Owns (Batch 16 domain audit): the candidate self-service profile - candidate_accounts and
-- candidate_experiences. The FULL candidate_accounts row is mirrored here (including the auth
-- columns id/name/email/phone/password_hash/is_active/deleted_at), matching exactly the same
-- convention Identity Service already uses for its own copy of this table (its own
-- src/db.ts's dualWrite.upsertCandidateAccount) - two services each hold a full-row mirror of the
-- same logical entity, split by which COLUMNS each one's application code actually reads/writes:
-- Identity Service owns the auth slice, this service owns the profile slice. Neither service
-- queries the other's database - see dualWrite.ts's header comment for the write-propagation
-- contract that keeps both copies in sync during migration.
--
-- Deliberately NOT included: candidate_refresh_tokens (Identity/auth's concern, not profile's).
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing here is invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- candidate_accounts (source: schema.sql "candidate_accounts")
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_accounts (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  email                VARCHAR(255) UNIQUE,
  phone                VARCHAR(20) UNIQUE,
  password_hash        VARCHAR(255) NOT NULL,
  is_active            BOOLEAN DEFAULT true,
  deleted_at           TIMESTAMP,
  headline             VARCHAR(255),
  skills               TEXT[],
  years_of_experience  VARCHAR(50),
  location             VARCHAR(255),
  education            TEXT,
  summary              TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  onboarding_completed_at TIMESTAMP,
  current_company        VARCHAR(255),
  certifications          TEXT[],
  tools                   TEXT[],
  languages               TEXT[],
  notice_period           VARCHAR(100),
  current_ctc             VARCHAR(100),
  expected_ctc            VARCHAR(100),
  open_to_work            BOOLEAN DEFAULT true,
  visible_to_recruiters   BOOLEAN DEFAULT true,
  course_name             VARCHAR(255),
  course_type             VARCHAR(50),
  specialization          VARCHAR(255),
  institution_name        VARCHAR(255),
  start_year              VARCHAR(10),
  end_year                VARCHAR(10),
  grading_system          VARCHAR(50),
  grade_value             VARCHAR(50),
  primary_skill           TEXT,
  secondary_skills        TEXT[],
  resume_file_path            VARCHAR(500),
  resume_original_filename    VARCHAR(255),
  resume_file_uploaded_at     TIMESTAMP,
  current_job_title           VARCHAR(255),
  projects                    TEXT,
  linkedin_url                VARCHAR(255),
  github_url                  VARCHAR(255),
  CONSTRAINT candidate_accounts_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- ============================================================================
-- candidate_experiences (source: schema.sql "candidate_experiences")
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_experiences (
  id                       SERIAL PRIMARY KEY,
  candidate_account_id     INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_title                VARCHAR(255),
  company                  VARCHAR(255),
  employment_type          VARCHAR(50),
  experience_years         INTEGER,
  experience_months        INTEGER,
  current_ctc              VARCHAR(100),
  expected_ctc             VARCHAR(100),
  notice_period            VARCHAR(100),
  current_location         VARCHAR(255),
  preferred_location       VARCHAR(255),
  key_responsibilities     TEXT,
  skills_used              TEXT[],
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_experiences_account ON candidate_experiences(candidate_account_id);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
