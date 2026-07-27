-- Phase 1 of the approved Marketplace Transformation: candidate identity, independent of any
-- company. Every existing identity table (users, refresh_tokens, password_history) is bound to
-- company_id/user_id NOT NULL FKs that assume a tenant - a candidate must not belong to one.
-- These two tables are therefore new and parallel, not extensions of the existing auth schema:
-- no company_id column anywhere here, by design.
BEGIN;

CREATE TABLE IF NOT EXISTS candidate_accounts (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255) NOT NULL,
  email                VARCHAR(255) UNIQUE,
  phone                VARCHAR(20) UNIQUE,
  password_hash        VARCHAR(255) NOT NULL,
  is_active            BOOLEAN DEFAULT true,
  deleted_at           TIMESTAMP,
  -- Profile fields (Phase 1 scope) - modeled on the existing candidates table's shape per the
  -- approved Repository-to-Blueprint Mapping, deliberately excluding recruiter-workflow-only
  -- fields (resume_file_path, extraction_status, company_id) that don't apply to a self-owned
  -- candidate profile.
  headline             VARCHAR(255),
  skills               TEXT[],
  years_of_experience  VARCHAR(50),
  location             VARCHAR(255),
  education            TEXT,
  summary              TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT candidate_accounts_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_candidate_accounts_email ON candidate_accounts(email);
CREATE INDEX IF NOT EXISTS idx_candidate_accounts_phone ON candidate_accounts(phone);

-- Mirrors refresh_tokens exactly (same columns, same semantics), FK'd to candidate_accounts
-- instead of users so a candidate session can never be confused with, or revoke, a staff one.
CREATE TABLE IF NOT EXISTS candidate_refresh_tokens (
  id             SERIAL PRIMARY KEY,
  candidate_id   INTEGER NOT NULL REFERENCES candidate_accounts(id) ON DELETE CASCADE,
  token_hash     VARCHAR(255) NOT NULL,
  user_agent     TEXT,
  ip_address     VARCHAR(64),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at     TIMESTAMP NOT NULL,
  revoked_at     TIMESTAMP,
  remember       BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_candidate_refresh_candidate ON candidate_refresh_tokens(candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_refresh_hash ON candidate_refresh_tokens(token_hash);

COMMIT;
