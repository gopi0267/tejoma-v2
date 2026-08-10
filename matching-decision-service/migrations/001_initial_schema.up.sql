-- Matching Decision Service - Full-migration batch - initial schema.
--
-- Owns dual-written, read-only-from-this-service's-own-code mirrors of `swipes`,
-- `recruiter_notes`, and `detailed_scoring_reports` - the OUTCOME data recorded once a real
-- recruiter decision or review action happens. The monolith remains the sole writer for all
-- three - swipe.routes.ts's recordSwipe and recruiter-review.routes.ts's upsertRecruiterNote/
-- upsertDetailedScoringReport are unchanged.
--
-- Deliberately does NOT touch the live-scoring engine itself (services.ts/matchingApi.ts) or the
-- request-time scoring logic in swipe.routes.ts/recruiter-review.routes.ts - only the OUTCOME rows
-- these already-existing, unchanged code paths write are mirrored here. This is the same
-- discipline held throughout this migration: mirror real data safely, never rush the algorithm
-- that produces it. See MIGRATION_RUNBOOK.md's full-migration section for why the scoring engine
-- itself remains explicitly out of scope.
--
-- Cross-service FKs dropped: candidate_id/job_id/created_by/updated_by/generated_by/company_id
-- all referenced tables owned elsewhere (candidates, jobs, users, companies) - all cross-service,
-- dropped to plain scoping/reference integers here.
--
-- Every column/type/default/constraint sourced directly from the monolith's own schema.sql (lines
-- 309-326, 508-519, 531-540) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS swipes (
  id                     SERIAL PRIMARY KEY,
  recruiter_id           INTEGER NOT NULL,
  candidate_id           INTEGER NOT NULL,
  job_id                 INTEGER NOT NULL,
  -- NUMERIC, not INTEGER, despite schema.sql's own CREATE TABLE statement - verified directly
  -- against the live database's real information_schema.columns (data_type: 'numeric'), which
  -- disagrees with schema.sql. A later migration (migration-swipes-action-numeric.sql, referenced
  -- in src/db.ts's recordSwipe comment: "the swipes.action column once silently rejected 0.5")
  -- widened this column to support the 0.5 "saved" action value, and schema.sql's own CREATE
  -- TABLE statement was never updated to reflect it - a real, silent drift between the schema
  -- doc and the live database, caught here by verifying against the running database directly
  -- rather than trusting the doc.
  action                 NUMERIC,
  match_score            NUMERIC,
  "timestamp"            TIMESTAMP,
  used_for_training      BOOLEAN,
  company_id             INTEGER NOT NULL,
  reason                 TEXT,
  breakdown              JSONB,
  decision_time_seconds  NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_swipes_company_id ON swipes(company_id);
CREATE INDEX IF NOT EXISTS idx_swipes_candidate_job_ts ON swipes(company_id, candidate_id, job_id, "timestamp" DESC);

CREATE TABLE IF NOT EXISTS recruiter_notes (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  candidate_id  INTEGER NOT NULL,
  job_id        INTEGER NOT NULL,
  note          TEXT NOT NULL,
  created_by    INTEGER,
  updated_by    INTEGER,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recruiter_notes_company_id_candidate_id_job_id_key UNIQUE (company_id, candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_recruiter_notes_company ON recruiter_notes(company_id);

CREATE TABLE IF NOT EXISTS detailed_scoring_reports (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  candidate_id  INTEGER NOT NULL,
  job_id        INTEGER NOT NULL,
  report        JSONB NOT NULL,
  generated_by  INTEGER,
  generated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT detailed_scoring_reports_company_candidate_job_key UNIQUE (company_id, candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_detailed_scoring_reports_company ON detailed_scoring_reports(company_id);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
