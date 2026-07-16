-- Company Approval Workflow (moderated tenant onboarding)
-- Additive only: one new enum, one new table, indexes. No existing table is altered.
-- Companies/users are never created directly from public signup anymore for NEW tenants -
-- they're only created when a superadmin approves a row in this table (see
-- db.approveCompanyRegistrationRequest / src/api/company-requests.routes.ts).

CREATE TYPE company_registration_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS company_registration_requests (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  company_website VARCHAR(255),
  industry VARCHAR(100),
  company_size VARCHAR(50),
  business_email VARCHAR(255) NOT NULL,
  company_phone VARCHAR(20),
  country VARCHAR(100),
  state VARCHAR(100),
  city VARCHAR(100),
  address TEXT,
  admin_name VARCHAR(255) NOT NULL,
  admin_email VARCHAR(255) NOT NULL,
  admin_phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  status company_registration_status NOT NULL DEFAULT 'pending',
  review_notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  resulting_company_id INTEGER REFERENCES companies(id),
  resulting_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_reg_status ON company_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_company_reg_created_at ON company_registration_requests(created_at DESC);

-- Only one live *pending* request per company name / business email / admin email at a time.
-- Rejected requests can be resubmitted; approved ones are already blocked by companies.name
-- and users.email being globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_name ON company_registration_requests(lower(company_name)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_biz_email ON company_registration_requests(lower(business_email)) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_reg_pending_admin_email ON company_registration_requests(lower(admin_email)) WHERE status = 'pending';
