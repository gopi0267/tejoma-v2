/**
 * Startup environment validation for Matching Reasoning Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * No JWT_SECRET/auth here: unlike the staff-facing services, this service has no user-facing HTTP
 * surface at all (Batch 26 domain audit - the AI Reasoning Layer is triggered as a background side
 * effect of candidate/job creation, which stays on the monolith; there is nothing here for API
 * Gateway to route). Its only inbound callers are the monolith itself (a shadow-validation call,
 * SHADOW_REASONING_ENABLED, gated in the monolith's own reasoningServiceShadow.ts) - trusted by
 * network boundary, same convention as every other /internal/* endpoint in this migration, just
 * with the caller/callee direction reversed.
 *
 * MATCHING_ML_SERVICE_URL: the Python BERT embedding service - called directly by this service's
 * own semanticReasoning.ts (its embedding-neighbor tier), never through the monolith, same as
 * matching-evaluation-service's own copy of this client. Optional/graceful-null (generateEmbedding
 * already returns null on failure) - not required at startup.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4012', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-reasoning-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
