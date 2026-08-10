-- Microservices Migration, Batch 23 (Matching Service extraction prep - no new service created by
-- this batch). Persists which scoring model is active - previously an in-memory-only
-- `let activeModelType` in src/services.ts, reset to 'random_forest' on every process restart and
-- unreadable by any process other than the one that set it. See schema.sql's copy of this table
-- for the full header comment.

CREATE TABLE IF NOT EXISTS matching_model_config (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_model_type   VARCHAR(20) NOT NULL DEFAULT 'random_forest'
                        CHECK (active_model_type IN ('heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted')),
  updated_at          TIMESTAMP DEFAULT NOW()
);

INSERT INTO matching_model_config (id, active_model_type) VALUES (1, 'random_forest')
  ON CONFLICT (id) DO NOTHING;
