-- Migration: persist the "remember me" preference across refresh token rotations,
-- so a session started with "remember me" unchecked stays a session-only cookie
-- even after being silently refreshed, instead of quietly becoming persistent.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS remember BOOLEAN DEFAULT true;
