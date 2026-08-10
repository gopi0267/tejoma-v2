-- Tejoma Recruitment Platform - Complete Schema
-- Generated for fresh PostgreSQL deployment (PostgreSQL 14+)
-- This file combines the 26 existing migration-*.sql files (fully merged into final-state
-- CREATE TABLE definitions, not replayed as separate ALTER statements) with inferred schema
-- for the 6 tables that had no CREATE TABLE in any migration file: users, companies, jobs,
-- otp_verification, daily_stats, model_versions.
--
-- Every column/type/default/constraint/index below was cross-verified against the live
-- production database via information_schema/pg_catalog introspection AND against every
-- src/**/*.ts query that touches each table - not guessed from one source alone. Re-verified and
-- brought back in sync (candidate_experiences, candidate_accounts' onboarding-v2 + resume-file
-- columns, detailed_scoring_reports, the production-hardening indexes/constraints/FK cascade
-- fixes) during the Production Database Hardening pass - see migration-db-hardening.sql.
--
-- Two tables that exist in the live database (recruiters, password_reset) are intentionally
-- NOT included here: neither is referenced anywhere in src/db.ts or any other application code
-- (confirmed via full-repo search) - they are orphaned/legacy tables outside the tables the
-- running application actually uses, and recreating unused schema would violate "do not include
-- draft/in-progress tables." Three more orphaned backup tables exist in the live database from
-- past migration operations (candidates_embedding_backup_pre_backfill,
-- jobs_embedding_backup_pre_backfill, swipes_backup_pre_numeric_migration) - also intentionally
-- excluded for the same reason.
--
-- Run with: psql -U tejoma_user -d tejoma_db -f schema.sql

BEGIN;

-- ============================================================================
-- EXTENSIONS
-- pg_trgm (bundled with contrib, allow-listed on RDS/Cloud SQL/Supabase/Neon/etc.) backs the
-- trigram GIN indexes on candidate_accounts below, which support ILIKE '%term%' search on
-- name/headline/location/current_company/summary - added by migration-db-hardening.sql.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;


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
  description_embedding  DOUBLE PRECISION[],
  -- Added by migration-phase1-intelligence-layer.sql (Enterprise AI Matching Architecture, Phase
  -- 1) - multi-facet embeddings alongside description_embedding above, which stays untouched and
  -- is still what src/services.ts reads for matching. Not yet consumed by scoring (Phase 2 work).
  skills_embedding           DOUBLE PRECISION[],
  responsibilities_embedding DOUBLE PRECISION[],
  title_embedding            DOUBLE PRECISION[]
);

CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_tech_stack ON jobs USING GIN (tech_stack);
CREATE INDEX IF NOT EXISTS idx_jobs_keywords ON jobs USING GIN (keywords);
-- Added by migration-phase0-unified-matching.sql (Enterprise AI Matching Architecture, Phase 0) -
-- required_skills is the single highest-weighted signal in the matching formula (40% of the
-- heuristic score) and had no supporting index at all before this.
CREATE INDEX IF NOT EXISTS idx_jobs_required_skills ON jobs USING GIN (required_skills);


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
  -- Added by migration-phase0-unified-matching.sql (Enterprise AI Matching Architecture, Phase 0).
  -- Additive, dual-written alongside `skills` above (which stays the source of truth for every
  -- pre-existing read path - mapRowToCandidate, getRecruiterReviewList's ILIKE filter, the
  -- skill-frequency string_to_array() query - none of that changed). skills_array is a real,
  -- GIN-indexed array projection of the same data, kept in sync on every create/update, used by
  -- the new structured pre-filter (db.getCandidatesForJobScoring) only.
  skills_array             TEXT[],
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
  -- Added by migration-multi-tenant-foundation.sql. ON DELETE CASCADE added by
  -- migration-db-hardening.sql - was NO ACTION (the oldest company_id FK in the schema,
  -- predating the CASCADE convention every later one adopted), standardized to match the other
  -- 9 company_id FKs. Inert against current behavior: no application code deletes a company.
  company_id               INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Added by migration-mutual-matching.sql - nullable, NULL for every ordinary resume-uploaded
  -- row. Set only when a candidate_accounts holder's own positive decision (swipe-right/apply)
  -- auto-creates or reuses this row, bridging the two identity systems so the recruiter's
  -- existing swipe pipeline can act on it unmodified. The REFERENCES itself is added further
  -- down as a standalone ALTER TABLE (see "Table 15: candidate_accounts" below) rather than
  -- inline here, since candidate_accounts is defined later in this file and Postgres requires
  -- the referenced table to already exist - a genuine ordering bug in this file prior to the
  -- Production Database Hardening pass, caught by actually running schema.sql end-to-end against
  -- a fresh database (it had never been verified that way before).
  candidate_account_id     INTEGER,
  -- Added by migration-phase1-intelligence-layer.sql (Enterprise AI Matching Architecture, Phase
  -- 1). confidence_profile is a structured, per-entity confidence enrichment computed at
  -- candidate-creation time from already-parsed data (src/matching/confidenceService.ts) -
  -- parser.service.ts itself is untouched. skills/responsibilities/title_embedding are additive,
  -- alongside resume_embedding above (untouched, still what src/services.ts reads for matching).
  confidence_profile          JSONB,
  skills_embedding             DOUBLE PRECISION[],
  responsibilities_embedding  DOUBLE PRECISION[],
  title_embedding              DOUBLE PRECISION[],
  -- Added by migration-phase5-structured-history.sql (Enterprise AI Matching Architecture, Phase
  -- 5 prerequisite). Dated, structured data the flat projects/current_company/previous_companies
  -- fields above never captured - see that migration file for the full field-shape doc and why it
  -- was needed (§2.2/§2.3/§2.4 of the architecture doc all depend on it). Null for any candidate
  -- parsed before this phase until re-parsed; projects/current_company/previous_companies are
  -- untouched and remain what every pre-existing caller reads.
  work_history                JSONB,
  project_entries             JSONB,
  -- Added by migration-phase6-recency-and-project-intelligence.sql (Enterprise AI Matching
  -- Architecture, §2.3 Project Intelligence Graph). One-hop USES/FRAMEWORK_OF graph inferences
  -- per project_entries item; never merged into skills/skills_array above. Populated in the
  -- background after candidate creation - see src/matching/projectIntelligence.ts. §2.2 Skill
  -- Recency & Evolution Intelligence is computed on demand from project_entries and is
  -- deliberately NOT stored - see that migration file's comment for why.
  project_intelligence        JSONB
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_id ON candidates(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_account_company ON candidates(candidate_account_id, company_id) WHERE candidate_account_id IS NOT NULL;
-- Added by migration-db-hardening.sql - lookup/dedupe during manual add and bulk import; no
-- index existed on this table beyond company_id.
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
-- Added by migration-phase0-unified-matching.sql (Enterprise AI Matching Architecture, Phase 0).
CREATE INDEX IF NOT EXISTS idx_candidates_skills_array ON candidates USING GIN (skills_array);


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
  -- Added by migration-multi-tenant-foundation.sql. ON DELETE CASCADE added by
  -- migration-db-hardening.sql (see candidates.company_id above for rationale).
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Added by migration-recruiter-review.sql (decision-change audit trail).
  reason                 TEXT,
  breakdown              JSONB,
  -- Added by migration-analytics-decision-timing.sql (Analytics Hub "Avg Review Velocity").
  decision_time_seconds  NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_swipes_company_id ON swipes(company_id);
CREATE INDEX IF NOT EXISTS idx_swipes_candidate_job_ts ON swipes(company_id, candidate_id, job_id, "timestamp" DESC);
-- Added by migration-db-hardening.sql - neither swipes nor match_scores had any index (or FK) on
-- job_id alone, despite "every swipe/score for this job" being a natural access pattern.
CREATE INDEX IF NOT EXISTS idx_swipes_job_id ON swipes(job_id);


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
  -- Added by migration-multi-tenant-foundation.sql. ON DELETE CASCADE added by
  -- migration-db-hardening.sql (see candidates.company_id above for rationale).
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_scores_company_id ON match_scores(company_id);
CREATE INDEX IF NOT EXISTS idx_match_scores_job_id ON match_scores(job_id);


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
-- The UNIQUE(recruiter_id, date) constraint below was missing from the live table until the
-- Production Database Hardening pass (migration-db-hardening.sql) added it - db.ts's
-- updateDailyStats() does `INSERT ... ON CONFLICT (recruiter_id, date) DO UPDATE ...`, which
-- requires exactly this constraint to function at all in PostgreSQL; without it, that code path
-- throws "no unique or exclusion constraint matching the ON CONFLICT specification" at runtime.
-- Currently inert either way: updateDailyStats()/getDailyStats() have no call sites in
-- src/api/ today, so this fixes the write path for whenever the feature is wired up, without
-- changing any currently-reachable behavior.
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
-- Table: matching_model_config
-- Added by migration-matching-model-config.sql (Microservices Migration, Batch 23 - Matching
-- Service extraction prep, not a Phase/product feature). Persists which scoring model is active
-- (previously an in-memory-only `let activeModelType` in src/services.ts, reset to
-- 'random_forest' on every process restart and unreadable by any other process). A single-row
-- table (id is CHECK-constrained to 1), not a generic config system - this stores exactly the one
-- setting that needed to stop being in-memory-only, nothing more.
-- ============================================================================
CREATE TABLE IF NOT EXISTS matching_model_config (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_model_type   VARCHAR(20) NOT NULL DEFAULT 'random_forest'
                        CHECK (active_model_type IN ('heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted')),
  updated_at          TIMESTAMP DEFAULT NOW()
);

INSERT INTO matching_model_config (id, active_model_type) VALUES (1, 'random_forest')
  ON CONFLICT (id) DO NOTHING;


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
-- Table: detailed_scoring_reports
-- Created by migration-detailed-scoring.sql - a separate, on-demand, LLM-judged report a
-- recruiter can generate per candidate+job pair, alongside (not replacing) the existing AI
-- matching engine. One row per (company, candidate, job), upserted on regenerate - same
-- shape/convention as recruiter_notes above.
-- ============================================================================
CREATE TABLE IF NOT EXISTS detailed_scoring_reports (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id        INTEGER NOT NULL,
  report        JSONB NOT NULL,
  generated_by  INTEGER REFERENCES users(id),
  generated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT detailed_scoring_reports_company_candidate_job_key UNIQUE (company_id, candidate_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_detailed_scoring_reports_company ON detailed_scoring_reports(company_id);


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
-- Table 15: candidate_accounts
-- Table 16: candidate_refresh_tokens
-- Created by migration-candidate-accounts.sql (Phase 1 of the Marketplace Transformation).
-- Deliberately independent of companies/users - a candidate identity, per the approved
-- Blueprint, does not belong to any company_id, unlike every table above.
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
  -- Phase 6: NULL until the first-login onboarding wizard is completed or skipped (added by
  -- migration-candidate-onboarding.sql; existing rows backfilled to their own created_at).
  onboarding_completed_at TIMESTAMP,
  -- Phase 7: candidate search / talent database facets + visibility controls (added by
  -- migration-candidate-search.sql). open_to_work/visible_to_recruiters default true so every
  -- existing candidate stays discoverable/open by default.
  current_company        VARCHAR(255),
  certifications          TEXT[],
  tools                   TEXT[],
  languages               TEXT[],
  notice_period           VARCHAR(100),
  current_ctc             VARCHAR(100),
  expected_ctc            VARCHAR(100),
  open_to_work            BOOLEAN DEFAULT true,
  visible_to_recruiters   BOOLEAN DEFAULT true,
  -- Added by migration-candidate-onboarding-v2.sql (structured single-entry education fields +
  -- Technical Skills/Tools split into primary/secondary skill columns, for the 6-step onboarding
  -- wizard). course_name/course_type/specialization/institution_name/start_year/end_year/
  -- grading_system/grade_value model one education entry directly on the account row (candidates
  -- have exactly one - see candidate_experiences below for the multi-entry work-history case).
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
  -- Added by migration-candidate-resume-file.sql (permanent resume file storage - separate from
  -- resume PARSING, which extracts text into the profile fields above and never persists the
  -- file itself). resume_file_path is a server-local filesystem path today (uploads/candidate-
  -- resumes/) - see the hardening report's storage recommendation before running multiple app
  -- instances.
  resume_file_path            VARCHAR(500),
  resume_original_filename    VARCHAR(255),
  resume_file_uploaded_at     TIMESTAMP,
  -- Added by migration-candidate-onboarding-v3.sql (two-path onboarding enhancement) -
  -- current_job_title is distinct from the `headline` tagline field above; projects is freeform
  -- text matching the raw `candidates` table's own convention.
  current_job_title           VARCHAR(255),
  projects                    TEXT,
  linkedin_url                VARCHAR(255),
  github_url                  VARCHAR(255),
  CONSTRAINT candidate_accounts_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- idx_candidate_accounts_email/_phone (plain, non-unique) were removed by
-- migration-db-hardening.sql - candidate_accounts_email_key/_phone_key below (backing the UNIQUE
-- constraints implied by `email VARCHAR(255) UNIQUE`/`phone VARCHAR(20) UNIQUE` above) already
-- cover every equality lookup Postgres would use these for; the separate indexes were pure
-- write-overhead duplicates.

-- Added by migration-db-hardening.sql - candidate search (db.searchCandidateAccounts) filters on
-- ILIKE '%term%' across these 5 columns and array-overlap (&&) across the 4 below; pg_trgm
-- trigram GIN indexes support ILIKE, plain GIN indexes support &&. Without these, every candidate
-- search filter forces a full sequential scan regardless of company/candidate-pool size.
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
-- query uses - covers the single most common filter+sort combination as an index-only scan.
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_searchable_updated
  ON candidate_accounts (updated_at DESC)
  WHERE visible_to_recruiters = true AND is_active = true AND deleted_at IS NULL AND onboarding_completed_at IS NOT NULL;

-- Deferred FK for candidates.candidate_account_id (see "Table 4: candidates" above) - added here,
-- not inline on that earlier table, because candidate_accounts had to exist first.
DO $$ BEGIN
  ALTER TABLE candidates ADD CONSTRAINT candidates_candidate_account_id_fkey
    FOREIGN KEY (candidate_account_id) REFERENCES candidate_accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS candidate_refresh_tokens (
  id             SERIAL PRIMARY KEY,
  candidate_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  token_hash     VARCHAR(255) NOT NULL,
  user_agent     TEXT,
  ip_address     VARCHAR(64),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at     TIMESTAMP NOT NULL,
  revoked_at     TIMESTAMP,
  remember       BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_candidate_refresh_candidate ON candidate_refresh_tokens(candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_refresh_hash ON candidate_refresh_tokens(token_hash);


-- ============================================================================
-- Table: candidate_experiences
-- Created by migration-candidate-onboarding-v2.sql ("Add Experience" step of the 6-step
-- onboarding wizard) - one-to-many work history, deliberately a separate child table from
-- candidate_accounts since a candidate can have any number of these (unlike the single-entry
-- education fields added by the same migration above). employment_type's value set includes
-- 'Internship' - internships and regular employment history are the same table, distinguished
-- only by this column, not a separate table.
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


-- ============================================================================
-- Table 17: candidate_decisions
-- Table 18: mutual_matches
-- Created by migration-mutual-matching.sql (Phase 3: candidate swipe/apply, decision
-- tracking, mutual matching engine). candidate_decisions mirrors swipes' append-only,
-- action-NUMERIC(0/1), latest-row-via-DISTINCT-ON shape on purpose, so match evaluation can
-- read both sides symmetrically.
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_decisions (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  action                 NUMERIC(3,1) NOT NULL CHECK (action IN (0, 1)),
  decision_type          VARCHAR(20) NOT NULL CHECK (decision_type IN ('swipe_right', 'swipe_left', 'apply')),
  "timestamp"            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_decisions_candidate ON candidate_decisions(candidate_account_id);
CREATE INDEX IF NOT EXISTS idx_candidate_decisions_job_ts ON candidate_decisions(candidate_account_id, job_id, "timestamp" DESC);

-- A Match forms only when the latest decision on both sides is positive for the same
-- (candidate_account, job) pair. UNIQUE is the DB-enforced duplicate-match guard; append-only/
-- immutable once created (never updated or deleted by later decisions on either side).
CREATE TABLE IF NOT EXISTS mutual_matches (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidates_id          INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  matched_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT mutual_matches_candidate_job_key UNIQUE (candidate_account_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_mutual_matches_candidate ON mutual_matches(candidate_account_id);
CREATE INDEX IF NOT EXISTS idx_mutual_matches_company_job ON mutual_matches(company_id, job_id);


-- ============================================================================
-- Table 19: candidate_notifications
-- Table 20: recruiter_notifications
-- Created by migration-notifications.sql (Phase 4). Both UNIQUE constraints are a second,
-- DB-level layer of duplicate-prevention on top of mutual_matches' own uniqueness.
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_notifications (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  -- Nullable as of migration-application-status.sql (Phase 5) - application_status_changed
  -- notifications aren't tied to a mutual_matches row; match_created rows still always set it.
  match_id               INTEGER REFERENCES mutual_matches(id) ON DELETE CASCADE,
  type                   VARCHAR(30) NOT NULL DEFAULT 'match_created',
  title                  VARCHAR(255) NOT NULL,
  message                TEXT NOT NULL,
  read_at                TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW(),
  -- Added by migration-application-status.sql (Phase 5), for application_status_changed rows.
  job_id                 INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT candidate_notifications_match_key UNIQUE (candidate_account_id, match_id, type)
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_candidate ON candidate_notifications(candidate_account_id, created_at DESC);

-- Addressed to the specific recruiter (user_id) whose swipe completed the match - personal,
-- not a shared company inbox.
CREATE TABLE IF NOT EXISTS recruiter_notifications (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  match_id               INTEGER NOT NULL REFERENCES mutual_matches(id) ON DELETE CASCADE,
  type                   VARCHAR(30) NOT NULL DEFAULT 'match_created',
  title                  VARCHAR(255) NOT NULL,
  message                TEXT NOT NULL,
  read_at                TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT recruiter_notifications_match_key UNIQUE (user_id, match_id, type)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_notifications_user ON recruiter_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruiter_notifications_company ON recruiter_notifications(company_id);


-- ============================================================================
-- Table 21: candidate_application_status
-- Created by migration-application-status.sql (Phase 5). Sourced entirely from the recruiter's
-- existing swipe-based decision workflow (see db.ts's syncApplicationStatusFromRecruiterDecision,
-- hooked into recordSwipe) - no new recruiter-facing write path. 'applied' is never written
-- here directly; it's the read-time default for a job the candidate applied to with no row yet.
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_application_status (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  job_id                 INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status                 VARCHAR(30) NOT NULL DEFAULT 'applied'
                           CHECK (status IN ('applied', 'under_review', 'shortlisted', 'rejected', 'accepted')),
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT candidate_application_status_key UNIQUE (candidate_account_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_application_status_candidate ON candidate_application_status(candidate_account_id);
CREATE INDEX IF NOT EXISTS idx_candidate_application_status_company_job ON candidate_application_status(company_id, job_id);


-- ============================================================================
-- Table 22: saved_candidates
-- Table 23: candidate_profile_views
-- Created by migration-candidate-search.sql (Phase 7: recruiter candidate search / talent
-- database). Both are personal, per-recruiter lists - never shared across a company's other
-- recruiters. candidate_accounts itself gained the search-facet + visibility columns documented
-- above; no other existing table was touched.
-- ============================================================================
CREATE TABLE IF NOT EXISTS saved_candidates (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT saved_candidates_unique UNIQUE (recruiter_user_id, candidate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_candidates_recruiter ON saved_candidates(recruiter_user_id);

CREATE TABLE IF NOT EXISTS candidate_profile_views (
  id                     SERIAL PRIMARY KEY,
  recruiter_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id             INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  viewed_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT candidate_profile_views_unique UNIQUE (recruiter_user_id, candidate_account_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_profile_views_recruiter ON candidate_profile_views(recruiter_user_id, viewed_at DESC);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 1 (Skill & Role Intelligence).
-- Added by migration-phase1-intelligence-layer.sql - see that file for full field-by-field
-- reasoning. Purely additive; not yet read by src/services.ts's live scoring (Phase 2 work).
-- ============================================================================

-- Skill Intelligence Platform: one row per canonical skill, seeded from the existing JD parser
-- skills dictionary (src/jd-parser/dictionaries/skills.dictionary.ts). Aliases live on the node
-- itself, not as separate edges.
CREATE TABLE IF NOT EXISTS skill_nodes (
  id                  SERIAL PRIMARY KEY,
  canonical_name      VARCHAR(150) NOT NULL,
  category            VARCHAR(40) NOT NULL,
  technology_domain   VARCHAR(80),
  aliases             TEXT[] NOT NULL DEFAULT '{}',
  popularity_score    NUMERIC DEFAULT 0,
  confidence          NUMERIC NOT NULL DEFAULT 1.0,
  is_deprecated       BOOLEAN NOT NULL DEFAULT false,
  is_emerging         BOOLEAN NOT NULL DEFAULT false,
  source              VARCHAR(30) NOT NULL DEFAULT 'dictionary',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_nodes_canonical_name_key UNIQUE (canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_category ON skill_nodes(category);
CREATE INDEX IF NOT EXISTS idx_skill_nodes_aliases ON skill_nodes USING GIN (aliases);

-- Typed skill-to-skill relationships. relationship_type is an open VARCHAR (PARENT_OF,
-- FRAMEWORK_OF, RELATED_TO, USES, COMMONLY_WITH populated in Phase 1; RUNS_ON/DATABASE_FOR
-- supported but intentionally left unpopulated - no verifiable seed data for them yet).
CREATE TABLE IF NOT EXISTS skill_edges (
  id                  SERIAL PRIMARY KEY,
  from_skill_id       INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  to_skill_id         INTEGER NOT NULL REFERENCES skill_nodes(id) ON DELETE CASCADE,
  relationship_type   VARCHAR(30) NOT NULL,
  weight              NUMERIC NOT NULL DEFAULT 1.0,
  source              VARCHAR(30) NOT NULL DEFAULT 'curated',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_edges_unique_triple UNIQUE (from_skill_id, to_skill_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_skill_edges_from ON skill_edges(from_skill_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_skill_edges_to ON skill_edges(to_skill_id, relationship_type);

-- Role Intelligence Platform: one row per role archetype, role_key is a stable slug so future
-- roles are a data insert, never a schema change.
CREATE TABLE IF NOT EXISTS role_profiles (
  id                        SERIAL PRIMARY KEY,
  role_key                  VARCHAR(60) NOT NULL,
  display_name              VARCHAR(120) NOT NULL,
  mandatory_skills          TEXT[] NOT NULL DEFAULT '{}',
  preferred_skills          TEXT[] NOT NULL DEFAULT '{}',
  optional_skills           TEXT[] NOT NULL DEFAULT '{}',
  common_tools              TEXT[] NOT NULL DEFAULT '{}',
  typical_responsibilities  TEXT[] NOT NULL DEFAULT '{}',
  preferred_certifications  TEXT[] NOT NULL DEFAULT '{}',
  experience_band_min       NUMERIC,
  experience_band_max       NUMERIC,
  related_roles             TEXT[] NOT NULL DEFAULT '{}',
  career_progression        TEXT[] NOT NULL DEFAULT '{}',
  embedding                 DOUBLE PRECISION[],
  source                    VARCHAR(30) NOT NULL DEFAULT 'seed',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT role_profiles_role_key_key UNIQUE (role_key)
);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 4 (Unknown Skill Discovery, architecture doc §5).
-- Added by migration-phase4-unknown-skill-discovery.sql. Purely additive: one new column on
-- skill_nodes, one new table.
-- ============================================================================

-- skill_nodes.embedding - Phase 1 gave role_profiles/candidates/jobs embedding columns but never
-- skill_nodes itself; Unknown Skill Discovery's semantic-understanding stage needs it to find a
-- new term's nearest neighbors among already-known skills.
ALTER TABLE skill_nodes ADD COLUMN IF NOT EXISTS embedding DOUBLE PRECISION[];

-- One row per distinct unresolved token ever encountered (UNIQUE on normalized_token - repeat
-- sightings bump mention_count rather than duplicating rows). is_skill/proposed_category are set
-- once at classification and never revisited on repeat sightings of an already-rejected token.
CREATE TABLE IF NOT EXISTS skill_discovery_proposals (
  id                          SERIAL PRIMARY KEY,
  raw_token                   VARCHAR(150) NOT NULL,
  normalized_token            VARCHAR(150) NOT NULL,
  source_type                 VARCHAR(10) NOT NULL CHECK (source_type IN ('resume', 'jd')),
  context_text                TEXT,
  mention_count               INTEGER NOT NULL DEFAULT 1,
  is_skill                    BOOLEAN,
  proposed_category           VARCHAR(40),
  nearest_neighbors           JSONB,
  proposed_relationship_type  VARCHAR(30),
  proposed_related_skill_id   INTEGER REFERENCES skill_nodes(id) ON DELETE SET NULL,
  confidence                  NUMERIC,
  status                      VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'auto_promoted', 'approved', 'rejected', 'not_a_skill')),
  promoted_skill_node_id       INTEGER REFERENCES skill_nodes(id) ON DELETE SET NULL,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at                 TIMESTAMP,
  reviewed_by                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT skill_discovery_proposals_token_unique UNIQUE (normalized_token)
);
CREATE INDEX IF NOT EXISTS idx_skill_discovery_proposals_status ON skill_discovery_proposals(status, created_at DESC);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 3 (Feature Store, Feedback Learning,
-- Learning-to-Rank, Evaluation Framework). Added by
-- migration-phase3-feature-store-and-evaluation.sql - see that file for full field-by-field
-- reasoning. No interview/offer/joined/withdrawn/viewed lifecycle stage is represented anywhere
-- here - none exist in this schema, and none are fabricated.
-- ============================================================================

-- Feature Store: append-only, one row per (job, candidate) scoring event, storing the exact
-- 8-dimensional feature vector fed to the ML ensemble (column order matches FEATURE_NAMES in
-- python-services/matching-ml-service/ensemble.py). computed_at gives point-in-time
-- correctness for future training/serving joins without training-serving skew.
CREATE TABLE IF NOT EXISTS match_features (
  id                       SERIAL PRIMARY KEY,
  company_id               INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                   INTEGER NOT NULL,
  candidate_id             INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  feature_schema_version   INTEGER NOT NULL DEFAULT 1,
  jaccard_skill_score      NUMERIC NOT NULL,
  cosine_text_score        NUMERIC NOT NULL,
  cosine_bert_score        NUMERIC NOT NULL,
  euclidean_feature_score  NUMERIC NOT NULL,
  experience_score         NUMERIC NOT NULL,
  location_score           NUMERIC NOT NULL,
  salary_score             NUMERIC NOT NULL,
  levenshtein_title_score  NUMERIC NOT NULL,
  weighting                VARCHAR(10) NOT NULL DEFAULT 'static',
  tier                     VARCHAR(10) NOT NULL DEFAULT 'full',
  model_version            VARCHAR(50),
  source                   VARCHAR(30) NOT NULL,
  computed_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_match_features_job_candidate ON match_features(job_id, candidate_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_features_company ON match_features(company_id);

-- Learning-to-Rank: deliberately separate from model_versions (the production classification
-- ensemble) - records isolated training runs of the new grouped XGBRanker/LGBMRanker models.
-- Never read by matchingApi.ts/services.ts's live scoring this phase.
CREATE TABLE IF NOT EXISTS ltr_model_versions (
  id                 SERIAL PRIMARY KEY,
  version            VARCHAR(50) NOT NULL,
  algorithm          VARCHAR(60) NOT NULL,
  training_examples  INTEGER NOT NULL,
  training_groups    INTEGER NOT NULL,
  ndcg_at_10         NUMERIC(6,4),
  trained_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active          BOOLEAN NOT NULL DEFAULT false
);

-- Evaluation Framework: historical record of ranking-quality evaluation runs (NDCG@K/MAP@K/MRR/
-- Precision@K/Recall@K), computed from real swipes.match_score + swipes.action grouped by
-- job_id. company_id-scoped like every other tenant-facing table.
CREATE TABLE IF NOT EXISTS match_evaluation_runs (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evaluated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  jobs_evaluated    INTEGER NOT NULL,
  swipes_evaluated  INTEGER NOT NULL,
  k                 INTEGER NOT NULL,
  ndcg_at_k         NUMERIC(6,4),
  map_at_k          NUMERIC(6,4),
  mrr               NUMERIC(6,4),
  precision_at_k    NUMERIC(6,4),
  recall_at_k       NUMERIC(6,4),
  data_volume_note  TEXT
);
CREATE INDEX IF NOT EXISTS idx_match_evaluation_runs_company ON match_evaluation_runs(company_id, evaluated_at DESC);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 8 (architecture doc §2.4 Career Intelligence
-- Platform). Added by migration-phase8-career-intelligence.sql - see that file for full
-- field-by-field reasoning, including why several spec details (BIGINT ids, VECTOR(384),
-- retention_risk_score) were deliberately corrected/omitted against real schema/precedent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS career_trajectories (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_sequence                JSONB NOT NULL,
  total_career_months        INTEGER,
  role_count                 INTEGER,
  progression_type           VARCHAR(20),
  seniority_level             VARCHAR(20),
  seniority_trend             VARCHAR(20),
  transitions                JSONB,
  avg_tenure_months           NUMERIC,
  median_tenure_months        NUMERIC,
  tenure_pattern               VARCHAR(20),
  gaps                        JSONB,
  domain_concentration         NUMERIC,
  domains                      JSONB,
  trajectory_embedding         DOUBLE PRECISION[],
  predicted_next_roles         JSONB,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT career_trajectories_candidate_unique UNIQUE (candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_candidate ON career_trajectories(candidate_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_company ON career_trajectories(company_id);
CREATE INDEX IF NOT EXISTS idx_career_trajectories_seniority ON career_trajectories(seniority_level);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 9 (architecture doc §5.1 AI Reasoning Layer). Added
-- by migration-phase9-reasoning-layer.sql - see that file for full field-by-field reasoning.
-- ============================================================================
CREATE TABLE IF NOT EXISTS reasoning_conclusions (
  id                      SERIAL PRIMARY KEY,
  subject_type            VARCHAR(20) NOT NULL,
  subject_id              INTEGER NOT NULL,
  conclusion_text         TEXT NOT NULL,
  conclusion_type         VARCHAR(50) NOT NULL,
  reasoning_type          VARCHAR(30) NOT NULL,
  evidence_chain          JSONB NOT NULL,
  conclusion_confidence   NUMERIC NOT NULL,
  confidence_derivation   TEXT,
  derived_from            VARCHAR(60) NOT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reasoning_conclusions_unique_triple UNIQUE (subject_type, subject_id, conclusion_text)
);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_subject ON reasoning_conclusions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_type ON reasoning_conclusions(reasoning_type);


-- ============================================================================
-- Enterprise AI Matching Architecture, Phase 11 (architecture doc §2.1 Proficiency Weighting,
-- SHADOW MODE ONLY). Added by migration-phase11-proficiency-shadow.sql - see that file for full
-- reasoning, including why this never affects a live match score.
-- ============================================================================
CREATE TABLE IF NOT EXISTS proficiency_shadow_scores (
  id                          SERIAL PRIMARY KEY,
  company_id                  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id                INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id                      INTEGER NOT NULL,
  base_match_score            NUMERIC NOT NULL,
  proficiency_adjusted_score  NUMERIC NOT NULL,
  overall_multiplier          NUMERIC NOT NULL,
  skill_multipliers           JSONB NOT NULL,
  computed_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Phase 11B (migration-phase11b-proficiency-analytics.sql) - the recruiter's real decision at
  -- the moment this shadow score was computed (0/0.5/1, same encoding as swipes.action). Score
  -- computation and the decision are the same atomic event here, so this is one denormalized
  -- column rather than a separate outcome-event table.
  decision_action              NUMERIC,
  -- Phase 12 (migration-phase12-career-shadow.sql) - career trajectory multiplier, computed at
  -- the same decision moment, chained on top of proficiency_adjusted_score. See
  -- careerWeighting.ts's module doc.
  career_multiplier            NUMERIC,
  career_progression_signal    NUMERIC,
  career_stability_signal      NUMERIC,
  career_domain_signal         NUMERIC,
  career_adjusted_score        NUMERIC,
  career_progression_type      VARCHAR(20),
  -- Phase 13 (migration-phase13-recency-shadow.sql) - skill recency multiplier, chained on top
  -- of career_adjusted_score (falling back to proficiency_adjusted_score when no career data
  -- exists). See recencyWeighting.ts's module doc.
  recency_multiplier            NUMERIC,
  recency_adjusted_score        NUMERIC,
  recency_role_expectation      VARCHAR(10),
  recency_skill_multipliers     JSONB,
  -- Phase 15 (migration-phase15-reasoning-shadow.sql) - reasoning-conclusions alignment
  -- multiplier, chained on top of recency_adjusted_score. See reasoningWeighting.ts's module
  -- doc, including why this reuses Phase 9's precomputed conclusions rather than re-traversing
  -- the skill graph live.
  reasoning_multiplier          NUMERIC,
  reasoning_density_signal      NUMERIC,
  reasoning_coverage_signal     NUMERIC,
  reasoning_quality_signal      NUMERIC,
  reasoning_adjusted_score      NUMERIC,
  reasoning_covered_domains     JSONB,
  reasoning_uncovered_domains   JSONB
);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_candidate_job ON proficiency_shadow_scores(candidate_id, job_id);
CREATE INDEX IF NOT EXISTS idx_proficiency_shadow_scores_company ON proficiency_shadow_scores(company_id);


-- ============================================================================
-- BGE-M3 + BGE-Reranker-v2-m3 retrieval shadow comparison (migration-bge-retrieval-shadow.sql).
-- SHADOW MODE ONLY - see that file and src/matching/bgeShadowRetrieval.ts for full reasoning.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bge_retrieval_shadow_comparisons (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id                INTEGER NOT NULL,
  pool_size             INTEGER NOT NULL,
  existing_ranking      JSONB NOT NULL,
  bge_ranking           JSONB,
  top10_overlap_count   INTEGER,
  top10_overlap_pct     NUMERIC,
  rank_correlation      NUMERIC,
  bge_available         BOOLEAN NOT NULL,
  embed_latency_ms      NUMERIC,
  rerank_latency_ms     NUMERIC,
  computed_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bge_retrieval_shadow_job ON bge_retrieval_shadow_comparisons(job_id);
CREATE INDEX IF NOT EXISTS idx_bge_retrieval_shadow_company ON bge_retrieval_shadow_comparisons(company_id);


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
