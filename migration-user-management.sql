-- User Management module (add recruiters to an existing company/tenant)
-- Additive only: nullable columns + one index on the existing users table. No new tables,
-- no changes to signup's INSERT shape - createUser() (used by signup) is untouched, and every
-- pre-existing row simply gets NULL for these new audit columns.

-- ============================================================
-- 1. Soft delete + audit trail. Status model:
--    deleted_at IS NOT NULL              -> soft-deleted (hidden, cannot log in)
--    deleted_at IS NULL AND is_active=false -> disabled (visible, cannot log in, re-enable-able)
--    deleted_at IS NULL AND is_active=true  -> active
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

-- ============================================================
-- 2. Every User Management list/filter/search query filters by company_id first.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
