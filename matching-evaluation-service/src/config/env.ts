/**
 * Startup environment validation for Matching Evaluation Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today
 * (src/utils/tokens.ts's signAccessToken), not a JWKS scheme - identical reasoning to
 * jd-parser-service's config/env.ts: staff auth has not cut over to Identity Service yet.
 *
 * MONOLITH_INTERNAL_URL: this service owns match_evaluation_runs/ltr_model_versions directly, but
 * swipe/candidate/job data and the live scoring engine's feature-vector computation
 * (calculateMatchScoresBatch) remain the monolith's - see README.md's "What this service owns vs.
 * proxies". Required, not graceful-null: neither ranking evaluation nor LTR training has a
 * reasonable fallback without it.
 *
 * MATCHING_ML_SERVICE_URL: the Python Learning-to-Rank service (ranker.py) - called directly by
 * this service, never through the monolith, same as the monolith's own algorithms/ltr-models.ts
 * client did. Optional/graceful-null (getRankerHealth/trainRanking already return null on
 * failure, same resilience the monolith's copy has always had) - not required at startup.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4011', 10);

// Identity Service's RS256 public key - staff access tokens are issued by Identity Service and
// verified here. JWT_SECRET below is retained only for any remaining legacy/internal use.
// job-service owns the jobs table; shadowDataHealth.ts reads job titles from it via
// /internal/jobs/by-ids instead of proxying to the monolith.
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';

export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY || '';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'MONOLITH_INTERNAL_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-evaluation-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
