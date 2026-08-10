/**
 * Startup environment validation for Recruiting Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today
 * (src/utils/tokens.ts's signAccessToken), not a JWKS scheme - identical reasoning to
 * jd-parser-service's config/env.ts (Batch 15): staff auth has not cut over to Identity Service
 * yet. Both routes this service exposes (recruiter-notifications, matches) are recruiter/admin
 * only - there is no candidate-facing surface here.
 *
 * MONOLITH_INTERNAL_URL: this service owns recruiter_notifications directly, but GET /api/matches
 * still needs mutual_matches joined with jobs and candidates - all three remain the monolith's
 * Recruiting/Matching domain (Batch 19 domain audit: recruiter-matches.routes.ts's own
 * getRecruiterMatches() query spans mutual_matches+jobs+candidates+recruiter_notifications, none
 * of which besides the last this service owns). Required, not graceful-null - a Recruiting
 * Service that can't reach it has no reasonable way to serve /matches at all.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4009', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

// Cross-service URLs (for recruiter-matches cutover)
export const CANDIDATE_SERVICE_URL = process.env.CANDIDATE_SERVICE_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';

// Feature flag for recruiter-matches cutover
export const RECRUITER_MATCHES_CUTOVER_ENABLED = process.env.RECRUITER_MATCHES_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'CANDIDATE_SERVICE_URL', 'JOB_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for recruiting-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
