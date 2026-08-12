/**
 * Startup environment validation for Recruiting Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * IDENTITY_JWT_PUBLIC_KEY: verifies RS256 tokens issued by Identity Service.
 * Recruiting Service has completed its cutover to Identity Service's RS256 tokens.
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

export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY || '';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

// Cross-service URLs (for recruiter-matches cutover)
export const CANDIDATE_SERVICE_URL = process.env.CANDIDATE_SERVICE_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';

// Feature flag for recruiter-matches cutover
export const RECRUITER_MATCHES_CUTOVER_ENABLED = process.env.RECRUITER_MATCHES_CUTOVER_ENABLED === 'true';


// MONOLITH_INTERNAL_URL is no longer REQUIRED: the monolith was decommissioned 2026-08-12 and is
// not part of the deployment. It stays an optional env var so the documented rollback (restore the
// app service and set this) works without a code change. Every remaining monolithClient call in
// this service is rollback-only fire-and-forget or dead code, verified non-blocking with the
// monolith stopped - see TEJOMA_FINAL_MICROSERVICES_DECOMMISSION_REPORT.md.
const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'CANDIDATE_SERVICE_URL', 'JOB_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL'];
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
    '\nFATAL: invalid environment configuration for recruiting-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
