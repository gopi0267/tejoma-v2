/**
 * Startup environment validation for Dynamic Weighting / Explainable Matching Service - mirrors
 * every other Tier 0 service's fail-fast convention.
 *
 * No JWT_SECRET/auth here: this service has no user-facing HTTP surface - like Role Intelligence
 * Service (Batch 29), nothing anywhere in the monolith calls the functions this service ports
 * (confirmed via grep - `weighting: 'dynamic'` and `retrieval:` are never actually set by any real
 * caller). This service exists, is fully tested, and has real endpoints ready for whichever future
 * caller needs them.
 *
 * No MONOLITH_INTERNAL_URL: this service needs nothing back from the monolith at request time -
 * every endpoint takes its full input (job/candidate fields, skill lists, prior computation
 * results) directly in the request body, matching Role Intelligence Service's precedent.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4017', 10);

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for dynamic-weighting-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
