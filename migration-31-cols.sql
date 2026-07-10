-- Migration: 31-Column Candidates Schema Setup

-- Drop dependent tables first to avoid foreign key errors
DROP TABLE IF EXISTS swipes CASCADE;
DROP TABLE IF EXISTS match_scores CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;

-- Recreate candidates table with exactly 31 horizontal columns
CREATE TABLE candidates (
    id SERIAL PRIMARY KEY,                          -- 1. S.No
    name VARCHAR(255) DEFAULT 'NULL',               -- 2. Name
    email VARCHAR(255) DEFAULT 'NULL',              -- 3. Email
    phone VARCHAR(255) DEFAULT 'NULL',              -- 4. Phone
    skills TEXT DEFAULT 'NULL',                     -- 5. Skills (Comma-separated)
    primary_skills TEXT DEFAULT 'NULL',             -- 6. Primary_Skills (Comma-separated)
    secondary_skills TEXT DEFAULT 'NULL',           -- 7. Secondary_Skills (Comma-separated)
    years_of_experience VARCHAR(255) DEFAULT 'NULL',-- 8. Years_of_Experience
    current_location VARCHAR(255) DEFAULT 'NULL',   -- 9. Current_Location
    preferred_location VARCHAR(255) DEFAULT 'NULL', -- 10. Preferred_Location
    current_company VARCHAR(255) DEFAULT 'NULL',    -- 11. Current_Company
    previous_companies TEXT DEFAULT 'NULL',         -- 12. Previous_Companies (Semicolon-separated)
    current_job_title VARCHAR(255) DEFAULT 'NULL',  -- 13. Current_Job_Title
    industry_domain VARCHAR(255) DEFAULT 'NULL',    -- 14. Industry_Domain
    education VARCHAR(255) DEFAULT 'NULL',          -- 15. Education
    highest_qualification VARCHAR(255) DEFAULT 'NULL',-- 16. Highest_Qualification
    graduation_year VARCHAR(255) DEFAULT 'NULL',    -- 17. Graduation_Year
    university VARCHAR(255) DEFAULT 'NULL',         -- 18. University
    certifications TEXT DEFAULT 'NULL',             -- 19. Certifications (Semicolon-separated)
    projects TEXT DEFAULT 'NULL',                   -- 20. Projects (Semicolon-separated)
    technical_tools TEXT DEFAULT 'NULL',            -- 21. Technical_Tools (Comma-separated)
    languages_known TEXT DEFAULT 'NULL',            -- 22. Languages_Known (Comma-separated)
    current_ctc VARCHAR(255) DEFAULT 'NULL',        -- 23. Current_CTC
    expected_ctc VARCHAR(255) DEFAULT 'NULL',       -- 24. Expected_CTC
    notice_period VARCHAR(255) DEFAULT 'NULL',      -- 25. Notice_Period
    willingness_to_relocate VARCHAR(255) DEFAULT 'NULL',-- 26. Willingness_to_Relocate
    linkedin_url VARCHAR(255) DEFAULT 'NULL',       -- 27. LinkedIn_URL
    github_or_portfolio_url VARCHAR(255) DEFAULT 'NULL',-- 28. GitHub_or_Portfolio_URL
    resume_summary TEXT DEFAULT 'NULL',             -- 29. Resume_Summary
    resume_text TEXT DEFAULT 'NULL',                -- 30. Resume_Text
    ai_confidence_score VARCHAR(255) DEFAULT 'NULL',-- 31. AI_Confidence_Score
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    extraction_status VARCHAR(50) DEFAULT 'success',
    resume_file_path VARCHAR(255) DEFAULT 'NULL',
    candidate_hash VARCHAR(64) DEFAULT 'NULL'
);

-- Recreate swipes table referencing candidates(id)
CREATE TABLE swipes (
    id SERIAL PRIMARY KEY,
    recruiter_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL,
    action INTEGER,
    match_score NUMERIC,
    timestamp TIMESTAMP,
    used_for_training BOOLEAN
);

-- Recreate match_scores table referencing candidates(id)
CREATE TABLE match_scores (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    feature_score NUMERIC,
    embedding_score NUMERIC,
    ml_score NUMERIC,
    final_score NUMERIC,
    rank INTEGER,
    created_at TIMESTAMP
);
