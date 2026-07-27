-- Permanent resume file storage for self-service candidate profiles. Additive only - no existing
-- column changed, no existing row touched. Separate from resume PARSING (candidate-resume.routes.ts's
-- /parse endpoint, which extracts text into profile fields and never persists the file) - this is
-- purely "keep a copy of the file the candidate uploaded, and let them replace it later."
BEGIN;

ALTER TABLE candidate_accounts
  ADD COLUMN IF NOT EXISTS resume_file_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS resume_original_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS resume_file_uploaded_at TIMESTAMP;

COMMIT;
