-- Tenant Directory Service - Tier 0 (Phase 11/12) - initial schema.
-- Owns (Phase 3(database) section 1): companies only - the tenant/company system of record.
--
-- Every column/type/default/constraint below is sourced directly from the monolith's own
-- schema.sql (the introspection-verified source of truth) - nothing here is invented.

BEGIN;

DO $$ BEGIN
  CREATE TYPE company_plan AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- companies (source: schema.sql "Table 1: companies")
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  industry      VARCHAR(100),
  plan          company_plan DEFAULT 'starter',
  seats_limit   INTEGER DEFAULT 5,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  company_slug  VARCHAR(150) NOT NULL,
  logo_url      TEXT,
  website       VARCHAR(255),
  CONSTRAINT companies_name_key UNIQUE (name),
  CONSTRAINT companies_slug_unique UNIQUE (company_slug)
);

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
