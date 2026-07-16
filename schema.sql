-- Tejoma Recruitment Platform - Complete Schema
-- Generated for fresh PostgreSQL deployment (PostgreSQL 14+)
-- This file combines the 15 existing migration-*.sql files (fully merged into final-state
-- CREATE TABLE definitions, not replayed as separate ALTER statements) with inferred schema
-- for the 6 tables that had no CREATE TABLE in any migration file: users, companies, jobs,
-- otp_verification, daily_stats, model_versions.
--
-- Every column/type/default/constraint/index below was cross-verified against the live
-- production-equivalent database via \d introspection AND against every src/**/*.ts query that
-- touches each table - not guessed from one source alone.
--
-- Two tables that exist in the live database (recruiters, password_reset) are intentionally
-- NOT included here: neither is referenced anywhere in src/db.ts or any other application code
-- (confirmed via full-repo search) - they are orphaned/legacy tables outside the 14 tables the
-- running application actually uses, and recreating unused schema would violate "do not include
-- draft/in-progress tables."
--
-- Run with: psql -U tejoma_user -d tejoma_db -f schema.sql

BEGIN;

-- ============================================================================
-- ENUM TYPES
-- Inferred from live database introspection (SELECT enum_range(...) / pg_enum) - none of these
-- CREATE TYPE statements exist in any migration-*.sql file. user_role's value set matches
-- src/types.ts's User.role union; company_plan matches Company.plan; job_status matches
-- Job.status; company_registration_status matches migration-company-approval.sql's own usage
-- (that migration ALTERs/references it but does not define it in isolation from this file).
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('recruiter', 'admin', 'superadmin', 'candidate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE company_plan AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('open', 'closed', 'on_hold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Defined here (used by company_registration_requests below) - see migration-company-approval.sql
DO $$ BEGIN
  CREATE TYPE company_registration_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- Table 1: companies
-- INFERRED (no CREATE TABLE in any migration file) - base columns (name, industry, plan,
-- seats_limit, is_active, timestamps) reconstructed from live introspection and from
-- src/db.ts's getOrCreateCompany/getCompanyById/getCompanyByName usage. company_slug, logo_url,
-- website were added later by migration-multi-tenant-foundation.sql (ALTER TABLE) - merged here
-- into the base definition since this file represents final current state, not a replay log.
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  industry      VARCHAR(100),
  plan          company_plan DEFAULT 'starter',
  seats_limit   INTEGER DEFAULT 5,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Added by migration-multi-tenant-foundation.sql; slug is `slugify(name)-id` computed in
  -- src/db.ts's getOrCreateCompany, unique per company, used in company-branding contexts.
  company_slug  VARCHAR(150) NOT NULL,
  logo_url      TEXT,
  website       VARCHAR(255),
  CONSTRAINT companies_name_key UNIQUE (name),
  CONSTRAINT companies_slug_unique UNIQUE (company_slug)
);


-- ============================================================================
-- Table 2: users
-- INFERRED (no CREATE TABLE in any migration file) - base columns reconstructed from live
-- introspection and from src/db.ts's createUser/getUserByEmail/getUserByPhone/updateUserPasswordHash
-- and src/api/auth.routes.ts's signup/login logic. email is nullable + phone-login support,
-- password_hash/company_id/role/name are NOT NULL per every INSERT in src/db.ts's createUser and
-- createUserByAdmin. phone + email-or-phone check added by migration-auth-otp.sql. deleted_at/
-- created_by/updated_by/disabled_by/password_reset_by/last_login_at added by
-- migration-user-management.sql - merged into the base definition here (final-state schema).
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  email              VARCHAR(255),
  password_hash      VARCHAR(255) NOT NULL,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role               user_role DEFAULT 'recruiter',
  is_active          BOOLEAN DEFAULT true,
  name               VARCHAR(255) NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Added by migration-auth-otp.sql (phone-based accounts; email became optional at the same time).
  phone              VARCHAR(20),
  -- Added by migration-user-management.sql (soft delete + audit trail; see db.softDeleteUser,
  -- db.createUserByAdmin, db.updateUserStatus, db.resetUserPasswordHash in src/db.ts).
  deleted_at         TIMESTAMP,
  created_by         INTEGER REFERENCES users(id),
  updated_by         INTEGER REFERENCES users(id),
  disabled_by        INTEGER REFERENCES users(id),
  password_reset_by  INTEGER REFERENCES users(id),
  last_login_at      TIMESTAMP,
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);


-- ============================================================================
-- Table 3: jobs
-- INFERRED base columns (no CREATE TABLE in any migration file) - reconstructed from live
-- introspection and src/db.ts's createJob/getJobs/getJobById (title/required_skills required by
-- every insert; status uses job_status enum, default 'open', matching src/api/job.routes.ts's
-- POST /jobs always passing status:'open'). company_id added by migration-multi-tenant-foundation.sql.
-- All optional_skills..parse_confidence columns added by migration-job-description-fields.sql
-- (JD-parser field set); description_embedding added by migration-matching-embeddings.sql.
-- Merged into one final-state definition here.
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                     SERIAL PRIMARY KEY,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                  VARCHAR(255) NOT NULL,
  description            TEXT,
  required_skills        TEXT[],
  experience_years       INTEGER DEFAULT 0,
  location               VARCHAR(255),
  salary_min             NUMERIC(10,2),
  salary_max             NUMERIC(10,2),
  status                 job_status DEFAULT 'open',
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Added by migration-job-description-fields.sql (JD-parser tiers: regex/dictionary/nlp/gliner).
  optional_skills        TEXT[] DEFAULT '{}',
  min_experience         NUMERIC,
  max_experience         NUMERIC,
  experience_unit        VARCHAR(10) CHECK (experience_unit IN ('years', 'months')),
  remote_type            VARCHAR(10) CHECK (remote_type IN ('remote', 'hybrid', 'onsite')),
  employment_type        VARCHAR(20) CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship', 'freelance', 'temporary')),
  industry               VARCHAR(255),
  department             VARCHAR(255),
  education              TEXT[] DEFAULT '{}',
  certifications         TEXT[] DEFAULT '{}',
  salary_currency        VARCHAR(3) CHECK (salary_currency IN ('INR', 'USD', 'EUR', 'GBP')),
  notice_period          VARCHAR(100),
  number_of_openings     INTEGER,
  required_languages     TEXT[] DEFAULT '{}',
  responsibilities       TEXT[] DEFAULT '{}',
  tech_stack             JSONB DEFAULT '{}',
  keywords               TEXT[] DEFAULT '{}',
  job_summary            TEXT,
  source_raw_text        TEXT,
  parse_confidence       JSONB DEFAULT '{}',
  -- Added by migration-matching-embeddings.sql (BERT embedding for AI matching cosine similarity).
  description_embedding  DOUBLE PRECISION[]
);

CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_tech_stack ON jobs USING GIN (tech_stack);
CREATE INDEX IF NOT EXISTS idx_jobs_keywords ON jobs USING GIN (keywords);


-- ============================================================================
-- Table 4: candidates
-- Base 31-column shape from migration-31-cols.sql. NOTE: that migration declared these as
-- VARCHAR(255)/TEXT with DEFAULT 'NULL' (the literal string, not SQL NULL) - live introspection
-- confirms the columns are now TEXT (widened from VARCHAR at some point outside any migration
-- file) but the 'NULL'-string-as-default convention is preserved exactly, since
-- src/db.ts's mapRowToCandidate() explicitly parses for the literal string 'null' - changing
-- this would break existing application parsing logic. company_id added by
-- migration-multi-tenant-foundation.sql; resume_embedding added by migration-add-embeddings.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidates (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT DEFAULT 'NULL',
  email                    TEXT DEFAULT 'NULL',
  phone                    TEXT DEFAULT 'NULL',
  skills                   TEXT DEFAULT 'NULL',
  primary_skills           TEXT DEFAULT 'NULL',
  secondary_skills         TEXT DEFAULT 'NULL',
  years_of_experience      TEXT DEFAULT 'NULL',
  current_location         TEXT DEFAULT 'NULL',
  preferred_location       TEXT DEFAULT 'NULL',
  current_company          TEXT DEFAULT 'NULL',
  previous_companies       TEXT DEFAULT 'NULL',
  current_job_title        TEXT DEFAULT 'NULL',
  industry_domain          TEXT DEFAULT 'NULL',
  education                TEXT DEFAULT 'NULL',
  highest_qualification    TEXT DEFAULT 'NULL',
  graduation_year          TEXT DEFAULT 'NULL',
  university               TEXT DEFAULT 'NULL',
  certifications           TEXT DEFAULT 'NULL',
  projects                 TEXT DEFAULT 'NULL',
  technical_tools          TEXT DEFAULT 'NULL',
  languages_known          TEXT DEFAULT 'NULL',
  current_ctc              TEXT DEFAULT 'NULL',
  expected_ctc             TEXT DEFAULT 'NULL',
  notice_period            TEXT DEFAULT 'NULL',
  willingness_to_relocate  TEXT DEFAULT 'NULL',
  linkedin_url             TEXT DEFAULT 'NULL',
  github_or_portfolio_url  TEXT DEFAULT 'NULL',
  resume_summary           TEXT DEFAULT 'NULL',
  resume_text              TEXT DEFAULT 'NULL',
  ai_confidence_score      TEXT DEFAULT 'NULL',
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extraction_status        TEXT DEFAULT 'success',
  resume_file_path         TEXT DEFAULT 'NULL',
  candidate_hash           VARCHAR(64) DEFAULT 'NULL',
  -- Added by migration-add-embeddings.sql (resume BERT embedding for AI matching).
  resume_embedding         DOUBLE PRECISION[],
  -- Added by migration-multi-tenant-foundation.sql.
  company_id               INTEGER NOT NULL REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_id ON candidates(company_id);


-- ============================================================================
-- Table 5: swipes
-- Base shape from migration-31-cols.sql. NOTE: recruiter_id and job_id are plain INTEGER with
-- NO foreign key constraint, confirmed by live introspection - this matches src/db.ts's
-- recordSwipe(), which accepts recruiter_id/job_id as plain numbers with no FK-dependent
-- validation, and is preserved as-is (not "fixed" here) since this file must not modify existing
-- table structures. company_id added by migration-multi-tenant-foundation.sql; reason/breakdown
-- added by migration-recruiter-review.sql; decision_time_seconds added by
-- migration-analytics-decision-timing.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS swipes (
  id                     SERIAL PRIMARY KEY,
  recruiter_id           INTEGER NOT NULL,
  candidate_id           INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL,
  action                 INTEGER,
  match_score            NUMERIC,
  "timestamp"            TIMESTAMP,
  used_for_training      BOOLEAN,
  -- Added by migration-multi-tenant-foundation.sql.
  company_id             INTEGER NOT NULL REFERENCES companies(id),
  -- Added by migration-recruiter-review.sql (decision-change audit trail).
  reason                 TEXT,
  breakdown              JSONB,
  -- Added by migration-analytics-decision-timing.sql (Analytics Hub "Avg Review Velocity").
  decision_time_seconds  NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_swipes_company_id ON swipes(company_id);
CREATE INDEX IF NOT EXISTS idx_swipes_candidate_job_ts ON swipes(company_id, candidate_id, job_id, "timestamp" DESC);


-- ============================================================================
-- Table 6: match_scores
-- Base shape from migration-31-cols.sql (job_id has no FK, same as swipes - preserved as-is).
-- company_id added by migration-multi-tenant-foundation.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS match_scores (
  id               SERIAL PRIMARY KEY,
  job_id           INTEGER NOT NULL,
  candidate_id     INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  feature_score    NUMERIC,
  embedding_score  NUMERIC,
  ml_score         NUMERIC,
  final_score      NUMERIC,
  rank             INTEGER,
  created_at       TIMESTAMP,
  -- Added by migration-multi-tenant-foundation.sql.
  company_id       INTEGER NOT NULL REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_match_scores_company_id ON match_scores(company_id);


-- ============================================================================
-- Table 7: otp_verification
-- INFERRED (no CREATE TABLE in any migration file) - base columns (email, otp_hash,
-- expires_at, attempts, max_attempts, verified) reconstructed from live introspection and
-- src/db.ts's createOtpRecord/getLatestOtpRecord/incrementOtpAttempts/markOtpVerified.
-- phone + purpose columns, and the otp -> otp_hash rename, were applied by
-- migration-auth-otp.sql (merged into the base definition here).
-- ============================================================================
CREATE TABLE IF NOT EXISTS otp_verification (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255),
  otp_hash      VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT now(),
  expires_at    TIMESTAMP NOT NULL,
  attempts      INTEGER DEFAULT 0,
  max_attempts  INTEGER DEFAULT 5,
  verified      BOOLEAN DEFAULT false,
  -- Added by migration-auth-otp.sql.
  phone         VARCHAR(20),
  purpose       VARCHAR(20) NOT NULL DEFAULT 'signup',
  CONSTRAINT otp_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Matches live index shape exactly (a simpler single-column index than migration-auth-otp.sql's
-- own stated intent of a composite (email, purpose, created_at) index - the live database
-- reflects the index actually in effect today, which is what this file reproduces).
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verification(email);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verification(phone, purpose, created_at DESC);


-- ============================================================================
-- Table 8: daily_stats
-- INFERRED (no CREATE TABLE in any migration file) - reconstructed from live introspection and
-- src/db.ts's getDailyStats/updateDailyStats.
-- DATA-SAFETY FIX: the live table has NO unique constraint on (recruiter_id, date), but
-- db.ts's updateDailyStats() does `INSERT ... ON CONFLICT (recruiter_id, date) DO UPDATE ...`,
-- which requires a matching unique constraint to function at all in PostgreSQL - without one,
-- that exact code path throws "no unique or exclusion constraint matching the ON CONFLICT
-- specification" at runtime. Added here per the "err on the side of data safety" instruction,
-- since omitting it would ship a fresh deployment with a table the app's own write path cannot
-- actually use.
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_stats (
  id               SERIAL PRIMARY KEY,
  recruiter_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  swipes_count     INTEGER DEFAULT 0,
  acceptance_rate  NUMERIC(5,2),
  date             DATE DEFAULT CURRENT_DATE,
  CONSTRAINT daily_stats_recruiter_date_unique UNIQUE (recruiter_id, date)
);


-- ============================================================================
-- Table 9: model_versions
-- INFERRED (no CREATE TABLE in any migration file) - reconstructed from live introspection and
-- src/db.ts's getLatestModelVersion/saveModelVersion (used by src/api/ml.routes.ts's ensemble
-- retraining, and read by db.getAnalyticsDashboardStats for the Dashboard's "Model accuracy" stat).
-- ============================================================================
CREATE TABLE IF NOT EXISTS model_versions (
  id                  SERIAL PRIMARY KEY,
  version             VARCHAR(50),
  accuracy            NUMERIC(5,2),
  training_examples   INTEGER,
  trained_at          TIMESTAMP,
  is_active           BOOLEAN DEFAULT false
);


-- ============================================================================
-- Table 10: refresh_tokens
-- Created by migration-refresh-tokens.sql. remember column added by migration-remember-flag.sql
-- (merged into the base definition here).
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  user_agent  TEXT,
  ip_address  VARCHAR(64),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  revoked_at  TIMESTAMP,
  -- Added by migration-remember-flag.sql.
  remember    BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);


-- ============================================================================
-- Table 11: password_history
-- Created by migration-password-history.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_history (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash  VARCHAR(255) NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at DESC);


-- ============================================================================
-- Table 12: knowledge_base_chunks
-- Created by migration-knowledge-base.sql (RAG chatbot knowledge base).
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  source_type  VARCHAR(20) NOT NULL CHECK (source_type IN ('candidate', 'job', 'company')),
  source_id    INTEGER NOT NULL,
  content      TEXT NOT NULL,
  embedding    DOUBLE PRECISION[] NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_base_chunks_source_type_source_id_key UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_company ON knowledge_base_chunks(company_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_source ON knowledge_base_chunks(source_type, source_id);


-- ============================================================================
-- Table 13: recruiter_notes
-- Created by migration-recruiter-review.sql.
-- ============================================================================
CREATE TABLE IF NOT EXISTS recruiter_notes (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id        INTEGER NOT NULL,
  note          TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  updated_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recruiter_notes_company_id_candidate_id_job_id_key UNIQUE (company_id, candidate_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_notes_company ON recruiter_notes(company_id);


-- ============================================================================
-- Table 14: company_registration_requests
-- Created by migration-company-approval.sql (Company Approval Workflow).
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_registration_requests (
  id                     SERIAL PRIMARY KEY,
  company_name           VARCHAR(255) NOT NULL,
  company_website        VARCHAR(255),
  industry               VARCHAR(100),
  company_size           VARCHAR(50),
  business_email         VARCHAR(255) NOT NULL,
  company_phone          VARCHAR(20),
  country                VARCHAR(100),
  state                  VARCHAR(100),
  city                   VARCHAR(100),
  address                TEXT,
  admin_name             VARCHAR(255) NOT NULL,
  admin_email            VARCHAR(255) NOT NULL,
  admin_phone            VARCHAR(20),
  password_hash          VARCHAR(255) NOT NULL,
  status                 company_registration_status NOT NULL DEFAULT 'pending',
  review_notes           TEXT,
  reviewed_by            INTEGER REFERENCES users(id),
  reviewed_at            TIMESTAMP,
  resulting_company_id   INTEGER REFERENCES companies(id),
  resulting_user_id      INTEGER REFERENCES users(id),
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_reg_status ON company_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_company_reg_created_at ON company_registration_requests(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_name ON company_registration_requests(lower(company_name)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_biz_email ON company_registration_requests(lower(business_email)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_admin_email ON company_registration_requests(lower(admin_email)) WHERE status = 'pending';


-- ============================================================================
-- Sequences
-- Not created explicitly - every id column above is SERIAL, which implicitly creates and owns
-- its own sequence (e.g. companies_id_seq, users_id_seq, ...). No standalone sequences are
-- referenced anywhere in src/ outside of the ones SERIAL already manages, EXCEPT one: db.ts's
-- getOrCreateCompany() and approveCompanyRegistrationRequest() both call
-- `SELECT nextval('companies_id_seq')` directly to reserve an id before a single-statement
-- INSERT (needed because company_slug is NOT NULL with no default, so the id must be known
-- up front) - this works against the SERIAL-owned sequence with no separate CREATE SEQUENCE
-- needed, since companies.id above already creates companies_id_seq.
-- ============================================================================

COMMIT;
