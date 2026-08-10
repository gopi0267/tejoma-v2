-- Identity Service - Tier 0 (Phase 11/12) - initial schema.
-- Owns (Phase 3(database) section 1): users(auth columns), refresh_tokens, password_history,
-- candidate_accounts(auth columns only), candidate_refresh_tokens, otp_verification.
--
-- Every column/type/default/constraint/index below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing here is invented.
--
-- IMPLEMENTATION ISSUE, resolved per the required methodology:
--   Problem: the monolith's users.company_id carries "REFERENCES companies(id)".
--   Why it exists: companies is owned by Tenant Directory Service - a separate physical
--     database once Tier 0 completes (Phase 3(database) section 1).
--   Impact: Postgres cannot enforce a foreign key across two separate database instances
--     (Phase 3(database) section 4's rule, restated here as its first concrete application).
--   Minimum change: company_id is created as a plain INTEGER NOT NULL with no REFERENCES
--     clause - the "opaque ID reference" pattern Phase 3(database) section 4 already specified
--     as the target design. Referential integrity for company_id moves to the application layer
--     (Identity Service validates a company_id via Tenant Directory's API at user-creation time,
--     added in a later batch).
--
-- This migration creates EMPTY tables only. It does not copy any row from the monolith's
-- production database - that is the explicitly separate, later dual-write/backfill batch,
-- gated on this schema first being validated (scripts/validate-schema.ts).

BEGIN;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('recruiter', 'admin', 'superadmin', 'candidate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- users (auth columns only - source: schema.sql "Table 2: users")
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id                 SERIAL PRIMARY KEY,
  email              VARCHAR(255),
  password_hash      VARCHAR(255) NOT NULL,
  company_id         INTEGER NOT NULL, -- opaque reference to Tenant Directory's companies.id - see header note
  role               user_role DEFAULT 'recruiter',
  is_active          BOOLEAN DEFAULT true,
  name               VARCHAR(255) NOT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  phone              VARCHAR(20),
  deleted_at         TIMESTAMP,
  created_by         INTEGER REFERENCES users(id),
  updated_by         INTEGER REFERENCES users(id),
  disabled_by        INTEGER REFERENCES users(id),
  password_reset_by  INTEGER REFERENCES users(id),
  last_login_at      TIMESTAMP,
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_phone_key UNIQUE (phone),
  CONSTRAINT users_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- ============================================================================
-- refresh_tokens (source: schema.sql "Table 10: refresh_tokens")
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  user_agent  TEXT,
  ip_address  VARCHAR(64),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  revoked_at  TIMESTAMP,
  remember    BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_hash ON refresh_tokens(token_hash);

-- ============================================================================
-- password_history (source: schema.sql "Table 11: password_history")
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_history (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash  VARCHAR(255) NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id, created_at DESC);

-- ============================================================================
-- candidate_accounts (AUTH COLUMNS ONLY - the Phase 3(database) section 4 "hard case" split).
-- Profile columns (headline, skills, education, etc.) remain owned by the monolith's original
-- table until Marketplace Service is extracted in Tier 1 (Phase 12 section 4) - this table
-- intentionally has far fewer columns than the monolith's real candidate_accounts table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS candidate_accounts (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255) UNIQUE,
  phone          VARCHAR(20) UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  is_active      BOOLEAN DEFAULT true,
  deleted_at     TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT candidate_accounts_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- ============================================================================
-- candidate_refresh_tokens (source: schema.sql, defined alongside candidate_accounts)
-- ============================================================================
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

-- ============================================================================
-- otp_verification (source: schema.sql "Table 7: otp_verification" - shared by both staff and
-- candidate OTP flows, identified by email/phone directly, no user_id/candidate_id column)
-- ============================================================================
CREATE TABLE IF NOT EXISTS otp_verification (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255),
  otp_hash      VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT now(),
  expires_at    TIMESTAMP NOT NULL,
  attempts      INTEGER DEFAULT 0,
  max_attempts  INTEGER DEFAULT 5,
  verified      BOOLEAN DEFAULT false,
  phone         VARCHAR(20),
  purpose       VARCHAR(20) NOT NULL DEFAULT 'signup',
  CONSTRAINT otp_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verification(email);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verification(phone, purpose, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
