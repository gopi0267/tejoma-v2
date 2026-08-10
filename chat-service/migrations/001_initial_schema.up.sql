-- Chat Service - Tier 0 (Batch 17) - initial schema.
-- Owns (Batch 17 domain audit): knowledge_base_chunks - the RAG chatbot's searchable knowledge
-- base, moved out of the monolith's shared database.
--
-- One deliberate difference from the monolith's own copy: company_id has NO foreign key here.
-- The monolith's schema.sql has `company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE`,
-- but companies is Tenant Directory Service's table, not this service's - a cross-database FK is
-- not physically possible, and cross-service FKs are exactly what "database-per-service, no
-- cross-service joins" rules out. company_id remains a plain scoping column (still indexed,
-- still used in every query exactly as before) - referential integrity for it is enforced at the
-- application layer (the value only ever originates from a real company_id the caller already
-- authenticated against), the same pattern already applied to candidate_decisions/mutual_matches
-- in the Batch 16 domain audit.
--
-- Every column/type/default/constraint below is otherwise sourced directly from the monolith's
-- own schema.sql (the introspection-verified source of truth) - nothing invented.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(20) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- knowledge_base_chunks (source: schema.sql "Table 12: knowledge_base_chunks")
-- ============================================================================
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER,
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

INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
