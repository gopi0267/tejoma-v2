/**
 * Startup environment validation for Candidate Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 candidate token the monolith issues today
 * (src/utils/tokens.ts's signCandidateAccessToken), not a JWKS scheme - identical reasoning to
 * jd-parser-service's config/env.ts (Batch 15): candidate auth has not cut over to Identity
 * Service yet, so every real candidate session cookie in production is still monolith-issued.
 *
 * MONOLITH_INTERNAL_URL: this service owns candidate_accounts/candidate_experiences directly, but
 * job listings, decisions, applications, and matches still belong to the monolith's Recruiting/
 * Matching domain (Batch 16 domain audit - candidate_decisions/mutual_matches have real foreign
 * keys into jobs/candidates/companies, none of which this service owns). Required, not
 * graceful-null: a Candidate Service that can't reach it has no reasonable way to serve
 * /candidate-jobs, /candidate-applications, /candidate-decisions, or /candidate-matches at all.
 *
 * IDENTITY_SERVICE_URL / MATCHING_SCORING_SERVICE_URL (Remaining-monolith migration, Step 5) -
 * candidate-search.routes.ts's real cutover (recruiter-facing candidate search, folded in here -
 * see migrations/003_candidate_search.up.sql's header comment for why) needs identity-service's
 * candidate_refresh_tokens table (last_active enrichment - this service's own domain doesn't own
 * candidate auth sessions) and matching-scoring-service's heuristic-tier ranking (the exact
 * pipeline candidate-search.routes.ts always used, ported in Step 2). Both required, not
 * graceful-null, for the same "no reasonable request to serve without them" reasoning as
 * MONOLITH_INTERNAL_URL above.
 *
 * CANDIDATE_CORE_SERVICE_URL / MATCHING_DECISION_SERVICE_URL (Remaining-monolith migration, Item 2) -
 * candidate-search.routes.ts's shortlisted tab real cutover needs candidate-core-service's candidate
 * data by ids and matching-decision-service's latest swipes per (candidate_id, job_id) pair.
 *
 * JOB_SERVICE_URL (Remaining-monolith migration, Item 4) - candidate-analytics computation needs
 * job data by ids for enrichment.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4005', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || '';
export const MATCHING_SCORING_SERVICE_URL = process.env.MATCHING_SCORING_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';
export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';

// Phase 4 Feature Flags
export const SHORTLIST_SEARCH_CUTOVER_ENABLED = process.env.SHORTLIST_SEARCH_CUTOVER_ENABLED === 'true';
export const CANDIDATE_ANALYTICS_CUTOVER_ENABLED = process.env.CANDIDATE_ANALYTICS_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'IDENTITY_SERVICE_URL', 'MATCHING_SCORING_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL', 'MATCHING_DECISION_SERVICE_URL', 'JOB_SERVICE_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  // Only fatal in production - the shared dev fallback above is deliberately allowed locally,
  // exactly matching jd-parser-service's risk posture for this same secret.
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for candidate-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
