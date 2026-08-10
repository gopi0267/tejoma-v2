-- Rollback notifications service initial schema

BEGIN;

DROP TABLE IF EXISTS notifications_service.schema_migrations CASCADE;
DROP TABLE IF EXISTS notifications_service.socket_connections CASCADE;
DROP TABLE IF EXISTS notifications_service.notification_preferences CASCADE;
DROP TABLE IF EXISTS notifications_service.notifications CASCADE;
DROP SCHEMA IF EXISTS notifications_service CASCADE;

COMMIT;
