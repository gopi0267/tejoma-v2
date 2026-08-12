/**
 * Startup environment validation for JD Parser Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * IDENTITY_JWT_PUBLIC_KEY: verifies RS256 tokens issued by Identity Service.
 */
import { config } from 'dotenv';
import { normalizePem } from '../utils/pem.js';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4004', 10);

export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY ? normalizePem(process.env.IDENTITY_JWT_PUBLIC_KEY) : '';

// Optional and gracefully-degrading by design (src/jd-parser/tiers/nlpTier.ts) - a down or
// unconfigured NLP service must never break JD parsing, so it is not in REQUIRED_ALWAYS.
export const JD_NLP_SERVICE_URL = process.env.JD_NLP_SERVICE_URL || 'http://localhost:8008';

const REQUIRED_ALWAYS: string[] = [];
const REQUIRED_PRODUCTION = ['IDENTITY_JWT_PUBLIC_KEY'];

if (IS_PRODUCTION) {
  for (const key of REQUIRED_PRODUCTION) {
    if (!process.env[key]) REQUIRED_ALWAYS.push(key);
  }
}

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for jd-parser-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
