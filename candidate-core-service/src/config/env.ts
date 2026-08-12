/**
 * Startup environment validation for Candidate Core Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * IDENTITY_JWT_PUBLIC_KEY: verifies RS256 tokens issued by Identity Service.
 *
 * MONOLITH_INTERNAL_URL: required now - the write proxy target (src/services/monolithClient.ts).
 */
import { config } from 'dotenv';
import { normalizePem } from '../utils/pem.js';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4019', 10);
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY ? normalizePem(process.env.IDENTITY_JWT_PUBLIC_KEY) : '';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const CANDIDATE_RESUME_CUTOVER_ENABLED = process.env.CANDIDATE_RESUME_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'MATCHING_DECISION_SERVICE_URL'];
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
    '\nFATAL: invalid environment configuration for candidate-core-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
