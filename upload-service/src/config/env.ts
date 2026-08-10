import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4030', 10);

// Database
export const DB_HOST = process.env.DB_HOST || 'localhost';
export const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
export const DB_NAME = process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads';
export const DB_USER = process.env.DB_USER || 'postgres';
export const DB_PASSWORD = process.env.DB_PASSWORD || '';

// JWT
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Storage (S3 or Azure Blob)
export const STORAGE_TYPE = process.env.STORAGE_TYPE || 's3'; // 's3' or 'azure'
export const S3_BUCKET = process.env.S3_BUCKET || 'tejoma-uploads';
export const S3_REGION = process.env.S3_REGION || 'us-east-1';
export const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
export const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';

// File limits
export const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760', 10); // 10MB
export const ALLOWED_MIME_TYPES = (process.env.ALLOWED_MIME_TYPES || 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword').split(',');

// Resume Service
export const RESUME_SERVICE_URL = process.env.RESUME_SERVICE_URL || '';
export const RESUME_SERVICE_ENABLED = process.env.RESUME_SERVICE_ENABLED === 'true';

// Monolith (dual-write)
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

// Virus scanning
export const CLAMAV_ENABLED = process.env.CLAMAV_ENABLED === 'true';
export const CLAMAV_HOST = process.env.CLAMAV_HOST || 'clamav';
export const CLAMAV_PORT = parseInt(process.env.CLAMAV_PORT || '3310', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'RESUME_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for upload-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
