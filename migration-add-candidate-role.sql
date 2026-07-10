-- Migration: add 'candidate' as a valid users.role value (RBAC scaffolding for Step 3)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'candidate';
