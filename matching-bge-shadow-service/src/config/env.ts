/**
 * Startup environment validation for Matching BGE Shadow Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * No JWT_SECRET/auth here: this service has no user-facing HTTP surface at all (same reasoning as
 * matching-reasoning-service's config/env.ts) - its only caller is the monolith's swipe.routes.ts,
 * fire-and-forget, trusted by network boundary.
 *
 * No MONOLITH_INTERNAL_URL either: unlike every prior batch, this service never needs to read
 * anything back from the monolith - swipe.routes.ts already has the full Job + ranked Candidate
 * list in memory at the point it calls this service, and passes them directly in the request body.
 *
 * BGE_SERVICE_URL: the Python BGE-M3/BGE-Reranker-v2-m3 service - called directly by this
 * service's own bgeRetrievalClient.ts, never through the monolith, same client shape (and same
 * "return null, never throw" contract) as the monolith's own original copy. Optional/graceful-null
 * (isBgeServiceAvailable already returns false on any failure) - not required at startup, since
 * nothing starts this Python service automatically in local dev either.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4014', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-bge-shadow-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
