-- Candidate Core Service: Knowledge Base Chunks (RAG Indexing)
-- Enables local RAG indexing without dependency on monolith
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL,
  source_type  VARCHAR(20) NOT NULL CHECK (source_type IN ('candidate', 'job', 'company')),
  source_id    INTEGER NOT NULL,
  content      TEXT NOT NULL,
  embedding    DOUBLE PRECISION[] NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_base_chunks_source_type_source_id_key UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_company ON knowledge_base_chunks(company_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_source ON knowledge_base_chunks(source_type, source_id);
