-- Resume Service Initial Schema

BEGIN;

CREATE SCHEMA IF NOT EXISTS resume_service;

CREATE TABLE resume_service.resumes (
  id BIGSERIAL PRIMARY KEY,
  upload_id BIGINT NOT NULL,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER,
  recruiter_id INTEGER,
  extracted_text TEXT,
  skills TEXT[],
  experience_years DECIMAL,
  education TEXT[],
  extraction_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
  extraction_error TEXT,
  skills_confidence DECIMAL DEFAULT 0.0,
  extracted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (candidate_id IS NOT NULL OR recruiter_id IS NOT NULL)
);

CREATE INDEX idx_resumes_upload ON resume_service.resumes(upload_id);
CREATE INDEX idx_resumes_candidate ON resume_service.resumes(candidate_id);
CREATE INDEX idx_resumes_recruiter ON resume_service.resumes(recruiter_id);
CREATE INDEX idx_resumes_company ON resume_service.resumes(company_id);
CREATE INDEX idx_resumes_status ON resume_service.resumes(extraction_status);
CREATE INDEX idx_resumes_created_desc ON resume_service.resumes(created_at DESC);
CREATE INDEX idx_resumes_skills ON resume_service.resumes USING GIN(skills);

CREATE TABLE resume_service.resume_extraction_jobs (
  id BIGSERIAL PRIMARY KEY,
  upload_id BIGINT NOT NULL,
  resume_id BIGINT,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER,
  job_status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (job_status IN ('queued', 'processing', 'completed', 'failed')),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_upload ON resume_service.resume_extraction_jobs(upload_id);
CREATE INDEX idx_jobs_status ON resume_service.resume_extraction_jobs(job_status);
CREATE INDEX idx_jobs_created ON resume_service.resume_extraction_jobs(created_at DESC);
CREATE INDEX idx_jobs_candidate ON resume_service.resume_extraction_jobs(candidate_id);

CREATE TABLE resume_service.schema_migrations (
  version BIGINT PRIMARY KEY,
  dirty BOOLEAN NOT NULL,
  tstamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
