/**
 * Startup environment validation for Candidate Core Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * JWT_SECRET: this service NOW has a real, gateway-routed, staff-facing HTTP surface
 * (remaining-monolith migration, Step 3a) - GET /api/candidates* is served directly from this
 * service's own already-fresh mirror; POST/DELETE (create/delete/bulk-upload/import) proxy to the
 * monolith (see MONOLITH_INTERNAL_URL below) so the monolith stays the sole writer - every OTHER
 * still-monolith surface that reads `candidates` directly keeps working unchanged. Same
 * staff-HS256 pattern already proven in 4 other services.
 *
 * MONOLITH_INTERNAL_URL: required now - the write proxy target (src/services/monolithClient.ts).
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4019', 10);
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';
export const CANDIDATE_RESUME_CUTOVER_ENABLED = process.env.CANDIDATE_RESUME_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'MATCHING_DECISION_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for candidate-core-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
