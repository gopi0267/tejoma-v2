/**
 * Startup environment validation for Career Intelligence Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * No JWT_SECRET/auth here: this service has no user-facing HTTP surface at all (same reasoning as
 * matching-reasoning-service's config/env.ts) - its only caller is the monolith's own
 * candidate.routes.ts (via src/careerIntelligenceServiceShadow.ts), fire-and-forget, trusted by
 * network boundary.
 *
 * No MONOLITH_INTERNAL_URL either: this service needs nothing back from the monolith at request
 * time - candidate.routes.ts already has the full work_history in memory and passes it directly
 * in the request body; role_profiles is satisfied entirely by this service's own dual-written
 * mirror.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4016', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for career-intelligence-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
