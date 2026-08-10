-- Candidate Service - Batch 20 - adds candidate_notifications.
-- Owns (Batch 20 domain audit): the candidate-facing notification feed - structurally identical
-- to Recruiting Service's recruiter_notifications (Batch 19), landing here instead of a new
-- service because candidate_notifications' primary FK target, candidate_accounts, is already
-- owned by THIS service (Batch 16) - unlike recruiter_notifications, which had no local FK target
-- at all.
--
-- candidate_account_id keeps a REAL foreign key here (candidate_accounts lives in this same
-- database) - the one case among this migration series where the FK-elimination pattern doesn't
-- apply, because the referenced table isn't cross-service anymore.
--
-- match_id and job_id have NO foreign keys here, for the usual reason: the monolith's schema.sql
-- has match_id REFERENCES mutual_matches(id) and job_id REFERENCES jobs(id), but both tables
-- belong to the still-monolith-owned Matching/Recruiting domain, not this service. Both remain
-- plain scoping columns (still indexed, still used in every query exactly as before) - the same
-- cross-service-FK-elimination pattern already applied to candidate_decisions/mutual_matches
-- (Batch 16) and recruiter_notifications' three dropped FKs (Batch 19).
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's
-- own schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS candidate_notifications (
  id                     SERIAL PRIMARY KEY,
  candidate_account_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  match_id               INTEGER,
  type                   VARCHAR(30) NOT NULL DEFAULT 'match_created',
  title                  VARCHAR(255) NOT NULL,
  message                TEXT NOT NULL,
  read_at                TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW(),
  job_id                 INTEGER,
  CONSTRAINT candidate_notifications_match_key UNIQUE (candidate_account_id, match_id, type)
);

CREATE INDEX IF NOT EXISTS idx_candidate_notifications_account ON candidate_notifications(candidate_account_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('002_notifications')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
