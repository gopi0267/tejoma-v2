-- Migration: RAG knowledge base for the chatbot.
-- Stores one embedded text "chunk" per indexed entity (candidate, job, company).
-- No pgvector extension is installed on this database, so embeddings are stored as a plain
-- double-precision array and similarity is computed in application code (cosine similarity) -
-- this is the same pattern already used for candidates.resume_embedding elsewhere in the schema.

CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
    id SERIAL PRIMARY KEY,
    -- NULL for source_type='candidate' - candidates are not company-scoped anywhere else in this
    -- app (the /api/candidates list itself has no company filter), so chunk visibility mirrors
    -- that existing behavior rather than introducing a new, inconsistent tenant boundary.
    -- Populated (and enforced at query time) for source_type='job' and 'company'.
    company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('candidate', 'job', 'company')),
    source_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding DOUBLE PRECISION[] NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_company ON knowledge_base_chunks(company_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_source ON knowledge_base_chunks(source_type, source_id);
