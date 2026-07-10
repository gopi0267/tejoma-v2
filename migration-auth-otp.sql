-- Migration: Real signup/login/forgot-password with OTP verification (email or phone)
-- Builds on the existing users/companies/otp_verification tables.

-- 1. Allow phone-based accounts on users (email stays unique but becomes optional)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE users ADD COLUMN phone VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE users ADD CONSTRAINT users_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Generalize otp_verification: email OR phone, tagged with a purpose, code stored hashed
ALTER TABLE otp_verification ALTER COLUMN email DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE otp_verification ADD COLUMN phone VARCHAR(20);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE otp_verification ADD COLUMN purpose VARCHAR(20) NOT NULL DEFAULT 'signup';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE otp_verification RENAME COLUMN otp TO otp_hash;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE otp_verification ADD CONSTRAINT otp_email_or_phone_chk CHECK (email IS NOT NULL OR phone IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verification (email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verification (phone, purpose, created_at DESC);

-- otp_hash now stores a bcrypt hash of the code, not the raw 6-digit code, so it needs more room
ALTER TABLE otp_verification ALTER COLUMN otp_hash TYPE VARCHAR(255);
