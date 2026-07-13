-- Migration: adds a BERT embedding column to jobs (candidates.resume_embedding already exists,
-- see migration-add-embeddings.sql, but was dormant - never populated by the live app until now).
-- Same plain double-precision-array pattern as candidates.resume_embedding (no pgvector
-- extension installed on this database) - similarity is computed in-app via cosineSimilarity.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_embedding double precision[] DEFAULT NULL;
