import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4032', 10);

// Database
export const DB_HOST = process.env.DB_HOST || 'localhost';
export const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
export const DB_NAME = process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications';
export const DB_USER = process.env.DB_USER || 'postgres';
export const DB_PASSWORD = process.env.DB_PASSWORD || '';

// JWT
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Redis (pub/sub for events)
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Monolith (dual-write)
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

// Socket.io settings
export const SOCKET_HEARTBEAT_INTERVAL = parseInt(process.env.SOCKET_HEARTBEAT_INTERVAL || '30000', 10);
export const SOCKET_CONNECTION_TIMEOUT = parseInt(process.env.SOCKET_CONNECTION_TIMEOUT || '60000', 10);

// Email/SMS (optional integrations)
export const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
export const SMS_ENABLED = process.env.SMS_ENABLED === 'true';
export const PUSH_ENABLED = process.env.PUSH_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'REDIS_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for notifications-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
