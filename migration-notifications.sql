-- Phase 4: candidate notifications, match notifications, notification-aware match centers.
-- Two new, fully additive tables - no ALTER on any existing table.
BEGIN;

-- One row per (candidate, match, type) - the UNIQUE constraint is a second, DB-level layer of
-- duplicate-prevention on top of mutual_matches' own uniqueness (belt-and-suspenders).
CREATE TABLE IF NOT EXISTS candidate_notifications (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  match_id               INTEGER NOT NULL REFERENCES mutual_matches(id) ON DELETE CASCADE,
  type                   VARCHAR(30) NOT NULL DEFAULT 'match_created',
  title                  VARCHAR(255) NOT NULL,
  message                TEXT NOT NULL,
  read_at                TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT candidate_notifications_match_key UNIQUE (candidate_account_id, match_id, type)
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_candidate ON candidate_notifications(candidate_account_id, created_at DESC);

-- Addressed to the specific recruiter (user_id) whose swipe completed the match - personal,
-- not a shared company inbox. company_id kept alongside for tenant-scoping/defense in depth.
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

COMMIT;
