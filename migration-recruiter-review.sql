-- Recruiter Review module
-- Additive only: two nullable columns on swipes, one supporting index, one new table.
-- swipes stays an append-only decision log exactly as it already behaves today - nothing
-- about POST /swipes or the swipe queue changes.

-- ============================================================
-- 1. swipes: reason (set only when a decision is changed via the new PATCH endpoint) and
--    breakdown (the already-computed MatchBreakdown, captured at decision time so historical
--    score components don't drift as the ML ensemble retrains).
-- ============================================================
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS breakdown JSONB;

CREATE INDEX IF NOT EXISTS idx_swipes_candidate_job_ts
  ON swipes (company_id, candidate_id, job_id, timestamp DESC);

-- ============================================================
-- 2. recruiter_notes: one editable free-text note per (company, candidate, job) pair -
--    not a threaded/versioned log, just the current note, same way a real ATS note field works.
-- ============================================================
CREATE TABLE IF NOT EXISTS recruiter_notes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, candidate_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_notes_company ON recruiter_notes(company_id);
