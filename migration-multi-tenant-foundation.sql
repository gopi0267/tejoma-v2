-- Multi-Tenant Foundation
-- Adds company scoping to candidates/swipes/match_scores (previously global/unscoped),
-- and adds branding fields to companies. Additive only; no existing columns are renamed or dropped.
--
-- Run this BEFORE deploying the corresponding backend code changes.
-- Take a backup first: bash scripts/backup-db.sh

-- ============================================================
-- 1. companies: add branding fields (name/plan/is_active already
--    cover company_name/subscription_plan/status - not duplicated)
-- ============================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_slug VARCHAR(150);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);

-- Backfill slugs for existing rows (the `-id` suffix guarantees uniqueness
-- even for the existing near-duplicate names like "Tejoma" / "Tejoma Technologies").
UPDATE companies
SET company_slug = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) || '-' || id
WHERE company_slug IS NULL;

ALTER TABLE companies ALTER COLUMN company_slug SET NOT NULL;
ALTER TABLE companies ADD CONSTRAINT companies_slug_unique UNIQUE (company_slug);

-- ============================================================
-- 2. candidates: add company scoping (previously had none at all)
-- ============================================================
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);

-- Backfill: this system has only ever really been used by one team (company 1)
-- up to this point, so all existing candidates are attributed there.
UPDATE candidates SET company_id = 1 WHERE company_id IS NULL;

ALTER TABLE candidates ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidates_company_id ON candidates(company_id);

-- ============================================================
-- 3. swipes: add company scoping (denormalized from jobs at write time)
-- ============================================================
ALTER TABLE swipes ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);

UPDATE swipes
SET company_id = jobs.company_id
FROM jobs
WHERE swipes.job_id = jobs.id AND swipes.company_id IS NULL;

-- Any orphaned swipes whose job no longer exists fall back to company 1.
UPDATE swipes SET company_id = 1 WHERE company_id IS NULL;

ALTER TABLE swipes ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_swipes_company_id ON swipes(company_id);

-- ============================================================
-- 4. match_scores: add company scoping (same pattern as swipes)
-- ============================================================
ALTER TABLE match_scores ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);

UPDATE match_scores
SET company_id = jobs.company_id
FROM jobs
WHERE match_scores.job_id = jobs.id AND match_scores.company_id IS NULL;

UPDATE match_scores SET company_id = 1 WHERE company_id IS NULL;

ALTER TABLE match_scores ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_scores_company_id ON match_scores(company_id);
