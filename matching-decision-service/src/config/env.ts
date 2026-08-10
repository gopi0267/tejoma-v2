/**
 * Startup environment validation for Matching Decision Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * Remaining-monolith migration, Step 6 - this service now has a real, gateway-routed,
 * staff-facing HTTP surface (/api/matches/queue/:job_id, /api/matches/score, /api/swipes*,
 * /api/recruiter-review* - see routes/matches.routes.ts's and routes/recruiterReview.routes.ts's
 * header comments for the real-cutover-vs-proxy split), so it needs the same real
 * CORS/cookie/auth wiring every other publicly-routed Tier 0 service has.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today, not a JWKS-based one.
 *
 * MONOLITH_INTERNAL_URL: only `GET /api/recruiter-review` (list) and `GET /api/recruiter-review/
 * :candidateId/:jobId` (detail) still proxy through to the monolith - a cross-database SQL JOIN
 * that can no longer be expressed once its tables live in separate databases (list), and
 * computeMatchExplanation, still fully unextracted (detail). Every other route on this service
 * (including `POST /api/swipes` since write-cutover completion Phase C, and every Recruiter
 * Review write since Phase D) still awaits a mirror call to this URL, but only as a
 * best-effort, non-fatal side call - not as the primary write path anymore.
 *
 * JOB_SERVICE_URL / CANDIDATE_CORE_SERVICE_URL / MATCHING_SCORING_SERVICE_URL: required for the
 * real-cutover routes (queue, score, swipe record/history/stats, recruiter-review notes/decision/
 * detailed-score) - job/candidate hydration plus live ranking, the same three-upstream fan-out
 * shape job-service's own GET /api/jobs/:id introduced in Step 4.
 *
 * GEMINI_API_KEY: required, not graceful-null - write-cutover completion Phase D's detailed-score
 * route has no fallback if Gemini is unreachable, same posture as chat-service's own identical
 * requirement.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4020', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';
export const MATCHING_SCORING_SERVICE_URL = process.env.MATCHING_SCORING_SERVICE_URL || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Remaining-monolith migration, Item 3 - recruiter-review detail cutover flag
export const RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED = process.env.RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED === 'true';

// Remaining-monolith migration, Item 5 - CQRS cutover flag for recruiter-review list
export const RECRUITER_REVIEW_LIST_CUTOVER_ENABLED = process.env.RECRUITER_REVIEW_LIST_CUTOVER_ENABLED === 'true';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL', 'JOB_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL', 'MATCHING_SCORING_SERVICE_URL', 'GEMINI_API_KEY'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  // Only fatal in production - the shared dev fallback above is deliberately allowed locally,
  // same risk posture as every other staff-auth Tier 0 service.
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-decision-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
