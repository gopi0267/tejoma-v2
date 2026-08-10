-- Job Service - Full-migration batch - initial schema.
--
-- Owns a dual-written, read-only-from-this-service's-own-code mirror of `jobs`. The monolith
-- remains the sole writer for now - job.routes.ts (create/update/delete) has real, live consumers
-- across many other still-monolithic modules (swipe.routes.ts, recruiter-review.routes.ts,
-- candidate-jobs browsing, analytics, chat/RAG indexing) that read `jobs` directly and cannot all
-- be safely repointed at this service in one batch. Same "mirror, not cutover" discipline applied
-- to role_profiles (Batch 29), career_trajectories (Batch 31 extension), etc. - this service's own
-- copy is real, complete, and kept in sync, ready for whichever future caller needs it (candidate-
-- facing job browsing is a strong first candidate, since it only ever reads, never scores).
--
-- Cross-service FK dropped: jobs.company_id referenced companies(id) in the monolith's own schema
-- - cross-service, dropped to a plain scoping integer here.
--
-- Every column/type/default sourced directly from the monolith's own schema.sql (lines 139-181) -
-- nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id                     SERIAL PRIMARY KEY,
  company_id             INTEGER NOT NULL,
  title                  VARCHAR(255) NOT NULL,
  description            TEXT,
  required_skills        TEXT[],
  experience_years       INTEGER DEFAULT 0,
  location               VARCHAR(255),
  salary_min             NUMERIC(10,2),
  salary_max             NUMERIC(10,2),
  status                 VARCHAR(20) DEFAULT 'open',
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  optional_skills        TEXT[] DEFAULT '{}',
  min_experience         NUMERIC,
  max_experience         NUMERIC,
  experience_unit        VARCHAR(10),
  remote_type            VARCHAR(10),
  employment_type        VARCHAR(20),
  industry               VARCHAR(255),
  department             VARCHAR(255),
  education              TEXT[] DEFAULT '{}',
  certifications         TEXT[] DEFAULT '{}',
  salary_currency        VARCHAR(3),
  notice_period          VARCHAR(100),
  number_of_openings     INTEGER,
  required_languages     TEXT[] DEFAULT '{}',
  responsibilities       TEXT[] DEFAULT '{}',
  tech_stack             JSONB DEFAULT '{}',
  keywords               TEXT[] DEFAULT '{}',
  job_summary            TEXT,
  source_raw_text        TEXT,
  parse_confidence       JSONB DEFAULT '{}',
  description_embedding  DOUBLE PRECISION[],
  skills_embedding           DOUBLE PRECISION[],
  responsibilities_embedding DOUBLE PRECISION[],
  title_embedding            DOUBLE PRECISION[]
);

CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_required_skills ON jobs USING GIN (required_skills);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
