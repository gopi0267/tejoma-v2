/**
 * Startup environment validation for Job Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * JWT_SECRET: this service now has a real, gateway-routed, staff-facing HTTP surface
 * (remaining-monolith migration, Step 4) - GET /api/jobs/:id is served directly by this service
 * (own DB read + candidate-core-service's candidate pool + matching-scoring-service's ranking);
 * GET /api/jobs (list), POST/PUT/DELETE proxy to the monolith (MONOLITH_INTERNAL_URL below).
 *
 * MONOLITH_INTERNAL_URL: required now - the write/list proxy target
 * (services/monolithClient.ts).
 *
 * CANDIDATE_CORE_SERVICE_URL: the candidate pool for GET /api/jobs/:id's real scoring cutover -
 * candidate-core-service's own dual-written mirror, not the monolith (services/
 * candidateCoreServiceClient.ts).
 *
 * MATCHING_SCORING_SERVICE_URL: the ranking call for the same real cutover - matching-scoring-
 * service's `/internal/rank-candidates-for-job` (Step 2), not the monolith's in-process
 * rankCandidatesForJob (services/matchingScoringServiceClient.ts).
 *
 * MATCHING_DECISION_SERVICE_URL: the swipe counts aggregation for GET /api/jobs (list) fan-out
 * (remaining-monolith migration, Item 1) - matching-decision-service's `/internal/swipes/
 * counts-by-job` (services/matchingDecisionServiceClient.ts).
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4018', 10);
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';
export const MATCHING_SCORING_SERVICE_URL = process.env.MATCHING_SCORING_SERVICE_URL || '';
export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';

// Phase 4 Feature Flags
export const JOB_LIST_CUTOVER_ENABLED = process.env.JOB_LIST_CUTOVER_ENABLED === 'true';

// Phase 1 Feature Flags (Sprint 1.1)
export const JOB_DETAIL_CUTOVER_ENABLED = process.env.JOB_DETAIL_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'CANDIDATE_CORE_SERVICE_URL', 'MATCHING_SCORING_SERVICE_URL', 'MATCHING_DECISION_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for job-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
