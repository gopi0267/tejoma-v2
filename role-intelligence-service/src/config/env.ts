/**
 * Startup environment validation for Role Intelligence Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * No JWT_SECRET/auth here: no route in the monolith currently exposes role-profile data over
 * HTTP at all (confirmed via grep across src/api/*.routes.ts) - this service has no user-facing
 * surface, only internal reads.
 *
 * No MONOLITH_INTERNAL_URL: this service never needs to read anything back from the monolith -
 * its only data need (role_profiles) is fully satisfied by its own dual-written mirror.
 *
 * MATCHING_ML_SERVICE_URL: the Python BERT embedding service - called directly by this service's
 * own matchRoleByTitle, never through the monolith, same client shape as every prior batch's own
 * copy. Optional/graceful-null - not required at startup.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4015', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for role-intelligence-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
