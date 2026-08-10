-- Item 3: ML admin state persistence
-- Stores activeModelType, isRetrainingInProgress, lastTrainingTimestamp in the database
-- instead of keeping them only in-memory (which were lost on restart).
-- This allows the service to restore its state after a pod restart.

BEGIN;

CREATE TABLE IF NOT EXISTS ml_state (
  id                      SERIAL PRIMARY KEY,
  active_model_type       VARCHAR(32) NOT NULL DEFAULT 'random_forest',
  is_retraining_in_progress BOOLEAN NOT NULL DEFAULT false,
  last_training_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT only_one_row CHECK (id = 1)
);

INSERT INTO ml_state (id, active_model_type, is_retraining_in_progress, last_training_timestamp)
  VALUES (1, 'random_forest', false, CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES ('003_ml_state')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
