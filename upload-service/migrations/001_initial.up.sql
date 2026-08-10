-- Upload Service Initial Schema
-- Phase 1: File storage and resume extraction pipeline

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER,
  recruiter_id INTEGER,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  mime_type VARCHAR(100),
  file_size_bytes INTEGER NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  upload_status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  file_hash VARCHAR(64),
  virus_scan_status VARCHAR(50),
  virus_scan_timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT valid_type CHECK (file_type IN ('resume', 'cover_letter', 'portfolio', 'document')),
  CONSTRAINT valid_status CHECK (upload_status IN ('pending', 'uploaded', 'processing', 'completed', 'failed', 'quarantined')),
  CONSTRAINT valid_scan_status CHECK (virus_scan_status IN ('pending', 'clean', 'infected', 'error')),
  CONSTRAINT has_candidate_or_recruiter CHECK (candidate_id IS NOT NULL OR recruiter_id IS NOT NULL)
);

CREATE INDEX idx_uploads_candidate_id ON uploads(candidate_id);
CREATE INDEX idx_uploads_recruiter_id ON uploads(recruiter_id);
CREATE INDEX idx_uploads_company_id ON uploads(company_id);
CREATE INDEX idx_uploads_status ON uploads(upload_status);
CREATE INDEX idx_uploads_created_at ON uploads(created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_initial') ON CONFLICT DO NOTHING;

COMMIT;
