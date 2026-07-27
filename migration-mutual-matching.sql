-- Phase 3: candidate swipe/apply, decision tracking, mutual matching engine.
-- Bridges the two identity systems (recruiter-owned `candidates` vs self-owned
-- `candidate_accounts`) via a new nullable link column, and adds two new, fully additive
-- tables. No existing table's existing columns/constraints/rows are altered.
BEGIN;

-- Nullable - existing resume-uploaded candidates rows are unaffected (stay NULL). Only set
-- when a candidate's own positive decision (swipe-right/apply) auto-creates or reuses a
-- candidates row so the recruiter's existing swipe pipeline can act on it unmodified.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_account_id INTEGER REFERENCES candidate_accounts(id) ON DELETE SET NULL;

-- One linked candidates row per (candidate_account, company) - prevents creating duplicate
-- rows if the same candidate applies to multiple jobs at the same company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_account_company ON candidates(candidate_account_id, company_id) WHERE candidate_account_id IS NOT NULL;

-- Candidate's own append-only decision log - mirrors swipes' shape/semantics exactly (action
-- NUMERIC 0/1, latest-row-per-pair computed at query time via the same
-- DISTINCT ON (...) ORDER BY timestamp DESC, id DESC convention already used for swipes).
-- decision_type is tracked separately since swipe_right and apply both resolve to action=1
-- for matching purposes but are distinct, user-visible decision types per the spec.
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
-- (candidate_account, job) pair. UNIQUE is the DB-enforced guarantee against duplicate
-- matches; append-only/immutable once created (never updated or deleted by later decisions).
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

COMMIT;
