-- Migration: extend `jobs` with the full JD-parser field set.
-- Additive only - existing columns (title, description, required_skills, experience_years,
-- location, salary_min, salary_max, status) are untouched for backward compatibility with the
-- current manual job-creation flow.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS optional_skills TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS min_experience NUMERIC,
    ADD COLUMN IF NOT EXISTS max_experience NUMERIC,
    ADD COLUMN IF NOT EXISTS experience_unit VARCHAR(10) CHECK (experience_unit IN ('years', 'months')),
    ADD COLUMN IF NOT EXISTS remote_type VARCHAR(10) CHECK (remote_type IN ('remote', 'hybrid', 'onsite')),
    ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship', 'freelance', 'temporary')),
    ADD COLUMN IF NOT EXISTS industry VARCHAR(255),
    ADD COLUMN IF NOT EXISTS department VARCHAR(255),
    ADD COLUMN IF NOT EXISTS education TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS salary_currency VARCHAR(3) CHECK (salary_currency IN ('INR', 'USD', 'EUR', 'GBP')),
    ADD COLUMN IF NOT EXISTS notice_period VARCHAR(100),
    ADD COLUMN IF NOT EXISTS number_of_openings INTEGER,
    ADD COLUMN IF NOT EXISTS required_languages TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS responsibilities TEXT[] DEFAULT '{}',
    -- Consolidates required_tools/technologies/frameworks/databases/cloud_platforms/methodologies
    -- into one JSONB column (sub-keys per category) instead of six near-duplicate array columns.
    ADD COLUMN IF NOT EXISTS tech_stack JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS job_summary TEXT,
    ADD COLUMN IF NOT EXISTS source_raw_text TEXT,
    -- Per-field extraction tier (regex/dictionary/nlp/gliner/derived) for audit/explainability.
    ADD COLUMN IF NOT EXISTS parse_confidence JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_jobs_tech_stack ON jobs USING GIN (tech_stack);
CREATE INDEX IF NOT EXISTS idx_jobs_keywords ON jobs USING GIN (keywords);
