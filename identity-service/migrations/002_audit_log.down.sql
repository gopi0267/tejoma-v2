BEGIN;

DROP TABLE IF EXISTS audit_log;

DELETE FROM schema_migrations WHERE version = '002_audit_log';

COMMIT;
