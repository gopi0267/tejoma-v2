-- Item 5: Candidate Resume Files - migrated from monolith candidate_accounts table
-- Stores resume_file_path, resume_original_filename, resume_file_uploaded_at per candidate
-- One resume file per candidate at a time (uniqueness on candidate_id)

BEGIN;

CREATE TABLE resume_service.candidate_resume_files (
  id BIGSERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL UNIQUE,
  -- Nullable: a candidate access token carries no company_id (identity-service's
  -- CandidateTokenPayload has never included one - candidates are not company-scoped here), so the
  -- candidate self-service upload path has no company to record. NOT NULL made every candidate
  -- upload fail the insert. The recruiter-side path, which does know a company, still populates it.
  company_id INTEGER,
  resume_file_path VARCHAR(500),
  resume_original_filename VARCHAR(255),
  resume_file_uploaded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_candidate_resume_files_candidate ON resume_service.candidate_resume_files(candidate_id);
CREATE INDEX idx_candidate_resume_files_company ON resume_service.candidate_resume_files(company_id);

COMMIT;
