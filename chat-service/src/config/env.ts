/**
 * Startup environment validation for Chat Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today
 * (src/utils/tokens.ts's signAccessToken), not a JWKS scheme - identical reasoning to
 * jd-parser-service's config/env.ts (Batch 15): staff auth has not cut over to Identity Service
 * yet.
 *
 * GEMINI_API_KEY: required, not graceful-null - unlike JD Parser's optional NLP tier, chat
 * generation and embedding are this service's entire purpose; there is no fallback path.
 *
 * MONOLITH_INTERNAL_URL: this service owns knowledge_base_chunks directly, but candidate/job
 * counts (for the "PLATFORM STATS" the chat prompt cites) and unscoped candidate/job lists (for
 * the admin reindex endpoint) still belong to the monolith's Recruiting/Matching domain (Batch 17
 * domain audit). Required, not graceful-null - a Chat Service that can't reach it can't answer
 * "how many candidates" questions accurately, which the system prompt treats as authoritative.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4006', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'GEMINI_API_KEY'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for chat-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
