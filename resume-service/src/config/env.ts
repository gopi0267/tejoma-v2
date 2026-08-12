import { config } from 'dotenv';
import { normalizePem } from '../utils/pem.js';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4031', 10);

// Database
export const DB_HOST = process.env.DB_HOST || 'localhost';
export const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
export const DB_NAME = process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume';
export const DB_USER = process.env.DB_USER || 'postgres';
export const DB_PASSWORD = process.env.DB_PASSWORD || '';

// JWT
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY ? normalizePem(process.env.IDENTITY_JWT_PUBLIC_KEY) : '';

// Gemini API
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Upload Service
export const UPLOAD_SERVICE_URL = process.env.UPLOAD_SERVICE_URL || '';
export const UPLOAD_SERVICE_ENABLED = process.env.UPLOAD_SERVICE_ENABLED === 'true';

// Monolith (dual-write)
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

// Redis (job queue)
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// NLP/Skill extraction
export const SKILL_EXTRACTION_MODEL = process.env.SKILL_EXTRACTION_MODEL || 'simple';
export const MIN_SKILL_CONFIDENCE = parseFloat(process.env.MIN_SKILL_CONFIDENCE || '0.6');

// Job queue
export const JOB_QUEUE_NAME = 'resume-extraction';
export const JOB_QUEUE_CONCURRENCY = parseInt(process.env.JOB_QUEUE_CONCURRENCY || '2', 10);
export const JOB_ATTEMPTS = parseInt(process.env.JOB_ATTEMPTS || '3', 10);

// File storage
export const RESUME_STORAGE_DIR = process.env.RESUME_STORAGE_DIR || './uploads/resumes';
export const TEMP_UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || './uploads/temp';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'UPLOAD_SERVICE_URL', 'REDIS_URL'];
const REQUIRED_PRODUCTION = ['IDENTITY_JWT_PUBLIC_KEY'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION) {
  for (const key of REQUIRED_PRODUCTION) {
    if (!process.env[key]) fatal.push(key);
  }
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for resume-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
