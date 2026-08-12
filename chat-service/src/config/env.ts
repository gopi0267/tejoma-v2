/**
 * Startup environment validation for Chat Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * IDENTITY_JWT_PUBLIC_KEY: verifies RS256 tokens issued by Identity Service.
 *
 * GEMINI_API_KEY: required, not graceful-null - chat
 * generation and embedding are this service's entire purpose; there is no fallback path.
 *
 * MONOLITH_INTERNAL_URL: this service owns knowledge_base_chunks directly, but candidate/job
 * counts (for the "PLATFORM STATS" the chat prompt cites) and unscoped candidate/job lists (for
 * the admin reindex endpoint) still belong to the monolith's Recruiting/Matching domain. Required, not graceful-null.
 */
import { config } from 'dotenv';
import { normalizePem } from '../utils/pem.js';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4006', 10);

export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY ? normalizePem(process.env.IDENTITY_JWT_PUBLIC_KEY) : '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'GEMINI_API_KEY', 'JOB_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL'];
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
    '\nFATAL: invalid environment configuration for chat-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
