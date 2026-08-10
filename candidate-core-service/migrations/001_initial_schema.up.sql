-- Candidate Core Service - Full-migration batch - initial schema.
--
-- Owns a dual-written, read-only-from-this-service's-own-code mirror of the monolith's
-- `candidates` table - the recruiter-facing, resume-parsed candidate profile (DISTINCT from
-- candidate-service's Batch 16 `candidate_accounts`, which is the candidate's own self-service
-- login/profile - two different bounded contexts that happen to share the word "candidate"). The
-- monolith remains the sole writer for now - candidate.routes.ts's create/update/delete are
-- unchanged, for the same reason job-service's own migration documents: many other still-
-- monolithic modules (swipe.routes.ts, recruiter-review.routes.ts, candidate-search.routes.ts,
-- upload.routes.ts, the live-scoring engine itself) read/write `candidates` directly and cannot
-- all be safely repointed at this service in one batch.
--
-- Cross-service FKs dropped: company_id referenced companies(id); candidate_account_id referenced
-- candidate_accounts(id) (owned by the existing candidate-service, Batch 16) - both cross-service,
-- dropped to plain scoping/reference integers here.
--
-- Every column/type/default sourced directly from the monolith's own schema.sql (lines 203-286) -
-- nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidates (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT DEFAULT 'NULL',
  email                    TEXT DEFAULT 'NULL',
  phone                    TEXT DEFAULT 'NULL',
  skills                   TEXT DEFAULT 'NULL',
  primary_skills           TEXT DEFAULT 'NULL',
  secondary_skills         TEXT DEFAULT 'NULL',
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
  resume_embedding         DOUBLE PRECISION[],
  company_id               INTEGER NOT NULL,
  candidate_account_id     INTEGER,
  confidence_profile       JSONB,
  skills_embedding             DOUBLE PRECISION[],
  responsibilities_embedding   DOUBLE PRECISION[],
  title_embedding               DOUBLE PRECISION[],
  work_history                 JSONB,
  project_entries               JSONB,
  project_intelligence          JSONB
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_id ON candidates(company_id);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_candidates_skills_array ON candidates USING GIN (skills_array);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
