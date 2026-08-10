-- Notifications Service Initial Schema

BEGIN;

CREATE SCHEMA IF NOT EXISTS notifications_service;

CREATE TABLE notifications_service.notifications (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  recipient_user_id INTEGER NOT NULL,
  sender_user_id INTEGER,
  notification_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  data JSONB,
  read_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_recipient ON notifications_service.notifications(recipient_user_id);
CREATE INDEX idx_notifications_company ON notifications_service.notifications(company_id);
CREATE INDEX idx_notifications_type ON notifications_service.notifications(notification_type);
CREATE INDEX idx_notifications_read ON notifications_service.notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_desc ON notifications_service.notifications(created_at DESC);

CREATE TABLE notifications_service.notification_preferences (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  notification_type VARCHAR(100) NOT NULL,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, user_id, notification_type, channel)
);

CREATE INDEX idx_prefs_user ON notifications_service.notification_preferences(user_id);
CREATE INDEX idx_prefs_company ON notifications_service.notification_preferences(company_id);
CREATE INDEX idx_prefs_type ON notifications_service.notification_preferences(notification_type);

CREATE TABLE notifications_service.socket_connections (
  id BIGSERIAL PRIMARY KEY,
  socket_id VARCHAR(255) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TIMESTAMP
);

CREATE INDEX idx_connections_user ON notifications_service.socket_connections(user_id);
CREATE INDEX idx_connections_company ON notifications_service.socket_connections(company_id);
CREATE INDEX idx_connections_connected ON notifications_service.socket_connections(connected_at DESC) WHERE disconnected_at IS NULL;

CREATE TABLE notifications_service.schema_migrations (
  version BIGINT PRIMARY KEY,
  dirty BOOLEAN NOT NULL,
  tstamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
