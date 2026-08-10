-- Platform Governance Service - Tier 0 (Phase 11/12) - initial schema.
-- Owns (Phase 3(database) section 1): company_registration_requests only - the moderated
-- tenant-onboarding workflow, moved out of the monolith's shared database.
--
-- Every column/type/default/constraint/index below is sourced directly from the monolith's own
-- schema.sql / migration-company-approval.sql (the introspection-verified source of truth) -
-- nothing here is invented.
--
-- IMPLEMENTATION ISSUE, resolved per the required methodology:
--   Problem: the monolith's company_registration_requests has reviewed_by INTEGER REFERENCES
--     users(id) and resulting_company_id/resulting_user_id REFERENCES companies(id)/users(id).
--   Why it exists: users and companies are owned by Identity Service and Tenant Directory
--     Service respectively - both separate physical databases once Tier 0 completes (Phase
--     3(database) section 4's rule, the same one already applied to Identity DB's company_id in
--     identity-service/migrations/001_initial_schema.up.sql).
--   Impact: Postgres cannot enforce a foreign key across separate database instances.
--   Minimum change: reviewed_by, resulting_company_id, and resulting_user_id are created as plain
--     INTEGER with no REFERENCES clause - the same "opaque ID reference" pattern already applied
--     to identity-service's users.company_id. Referential integrity moves to the application
--     layer (this service validates reviewer identity via the staff JWT it already verifies, and
--     resulting_company_id/resulting_user_id are only ever written by this service's own approval
--     logic, once that logic exists - see routes/company-requests.routes.ts's header comment for
--     why the approve endpoint itself is not part of this batch).
--
-- This migration creates an EMPTY table only. It does not copy any row from the monolith's
-- production database - that is the explicitly separate, later dual-write/backfill batch.

BEGIN;

DO $$ BEGIN
  CREATE TYPE company_registration_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- company_registration_requests (source: schema.sql / migration-company-approval.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_registration_requests (
  id                     SERIAL PRIMARY KEY,
  company_name           VARCHAR(255) NOT NULL,
  company_website        VARCHAR(255),
  industry               VARCHAR(100),
  company_size           VARCHAR(50),
  business_email         VARCHAR(255) NOT NULL,
  company_phone          VARCHAR(20),
  country                VARCHAR(100),
  state                  VARCHAR(100),
  city                   VARCHAR(100),
  address                TEXT,
  admin_name             VARCHAR(255) NOT NULL,
  admin_email            VARCHAR(255) NOT NULL,
  admin_phone            VARCHAR(20),
  password_hash          VARCHAR(255) NOT NULL,
  status                 company_registration_status NOT NULL DEFAULT 'pending',
  review_notes           TEXT,
  reviewed_by            INTEGER, -- opaque reference to Identity DB's users.id - see header note
  reviewed_at            TIMESTAMP,
  resulting_company_id   INTEGER, -- opaque reference to Tenant Directory's companies.id - see header note
  resulting_user_id      INTEGER, -- opaque reference to Identity DB's users.id - see header note
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_reg_status ON company_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_company_reg_created_at ON company_registration_requests(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_name ON company_registration_requests(lower(company_name)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_biz_email ON company_registration_requests(lower(business_email)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_admin_email ON company_registration_requests(lower(admin_email)) WHERE status = 'pending';

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
