-- Recruiting Service - Tier 0 (Batch 19) - initial schema.
-- Owns (Batch 19 domain audit): recruiter_notifications - the recruiter-facing notification feed
-- created when a mutual match forms, moved out of the monolith's shared database.
--
-- Three deliberate differences from the monolith's own copy: user_id, company_id, and match_id
-- have NO foreign keys here. The monolith's schema.sql has
--   user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
--   company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE
--   match_id   INTEGER NOT NULL REFERENCES mutual_matches(id) ON DELETE CASCADE
-- but users/companies/mutual_matches belong to Identity/Tenant-Directory/the still-monolith-owned
-- Matching domain respectively, none of which are this service's tables - a cross-database FK is
-- not physically possible, and cross-service FKs are exactly what "database-per-service, no
-- cross-service joins" rules out. All three remain plain scoping columns (still indexed, still
-- used in every query exactly as before) - referential integrity is enforced at the application
-- layer (every value only ever originates from an authenticated staff session or a monolith write
-- this service mirrors), the same pattern already applied to candidate_decisions/mutual_matches
-- (Batch 16) and knowledge_base_chunks.company_id (Batch 17).
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's
-- own schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- recruiter_notifications (source: schema.sql "recruiter_notifications")
-- ============================================================================
CREATE TABLE IF NOT EXISTS recruiter_notifications (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL,
  company_id             INTEGER NOT NULL,
  match_id               INTEGER NOT NULL,
  type                   VARCHAR(30) NOT NULL DEFAULT 'match_created',
  title                  VARCHAR(255) NOT NULL,
  message                TEXT NOT NULL,
  read_at                TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW(),
  CONSTRAINT recruiter_notifications_match_key UNIQUE (user_id, match_id, type)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_notifications_user ON recruiter_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruiter_notifications_company ON recruiter_notifications(company_id);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
