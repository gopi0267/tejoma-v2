-- Enterprise AI Matching Architecture, Phase 9 - §5.1 AI Reasoning Layer.
--
-- One row per named, auditable conclusion the Reasoning Layer derives about a candidate or job
-- that was never explicitly stated. subject_id is deliberately NOT a foreign key: subject_type
-- disambiguates whether it points into candidates(id) or jobs(id), and Postgres has no native
-- polymorphic FK - cleanup on candidate/job deletion is instead done explicitly in
-- db.deleteCandidate/db.deleteJob (see src/db.ts).
CREATE TABLE IF NOT EXISTS reasoning_conclusions (
  id                      SERIAL PRIMARY KEY,
  subject_type            VARCHAR(20) NOT NULL,
  subject_id              INTEGER NOT NULL,
  conclusion_text         TEXT NOT NULL,
  conclusion_type         VARCHAR(50) NOT NULL,
  reasoning_type          VARCHAR(30) NOT NULL,
  evidence_chain          JSONB NOT NULL,
  conclusion_confidence   NUMERIC NOT NULL,
  confidence_derivation   TEXT,
  derived_from            VARCHAR(60) NOT NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reasoning_conclusions_unique_triple UNIQUE (subject_type, subject_id, conclusion_text)
);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_subject ON reasoning_conclusions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_conclusions_type ON reasoning_conclusions(reasoning_type);
