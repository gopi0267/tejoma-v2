-- Identity Service - Tier 0 (Phase 11/12) - audit log for security-relevant identity events.
--
-- IMPLEMENTATION NOTE, per the required methodology - this is a NEW capability, not a port:
--   Problem: the monolith has no audit trail anywhere for authentication events (confirmed by
--     grep: no audit_log table exists in schema.sql, no auditLog/audit_trail function in
--     src/db.ts). Login attempts, password resets, and OAuth sign-ins happen with no durable,
--     queryable record of who/when/from-where beyond what's in the raw JSON access logs.
--   Why it matters: a dedicated Identity Service is exactly where this belongs (Phase 9(domain
--     analysis)'s bounded-context rationale for extracting identity in the first place) - a real
--     production auth service needs a durable record of security-relevant events for incident
--     investigation and compliance, independent of log retention on the app server.
--   Minimum addition: one small, append-only table, scoped to Identity DB only (same
--     database-per-service isolation Batch 3 already established) - not a general-purpose
--     analytics/event table, not shared with any other service, no new cross-service dependency.
--
-- This table records EVENTS, not sessions - it has no foreign key to refresh_tokens/
-- candidate_refresh_tokens (those already track session lifecycle) and no FK to users/
-- candidate_accounts either, deliberately: a failed login attempt has no actor_id (the identifier
-- tried might not even correspond to a real account, and revealing that via a DB constraint
-- violation would leak account existence through a side channel). actor_id is a plain, unindexed-
-- by-FK nullable integer for the same "opaque reference, no forced referential integrity" reason
-- Phase 3(database) section 4 already established for cross-service references - here it's
-- intra-service, but the same principle (an audit record must never fail to write because the
-- thing it's describing didn't fully succeed) applies.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_type   VARCHAR(20) NOT NULL, -- 'staff' | 'candidate'
  actor_id     INTEGER,              -- nullable: e.g. a failed login has no known account
  event_type   VARCHAR(50) NOT NULL, -- e.g. 'login_success', 'login_failed', 'password_reset', 'oauth_signin', 'refresh_token_reuse_detected'
  ip_address   VARCHAR(64),
  user_agent   TEXT,
  metadata     JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_log_actor_type_chk CHECK (actor_type IN ('staff', 'candidate'))
);

-- The two real query patterns this table exists to serve: "show me everything for this actor"
-- and "show me everything of this event type in a time range" (incident investigation).
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('002_audit_log')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
