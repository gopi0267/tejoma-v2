BEGIN;

DROP TABLE IF EXISTS ml_state;

DELETE FROM schema_migrations WHERE version = '003_ml_state';

COMMIT;
