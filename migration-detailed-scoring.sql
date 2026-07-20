-- Detailed Rubric Scoring Report - a separate, on-demand, LLM-judged report a recruiter can
-- generate per candidate+job pair, alongside (not replacing) the existing AI matching engine.
-- Additive only. One row per (company, candidate, job), upserted on regenerate - same shape/
-- convention as recruiter_notes.

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
