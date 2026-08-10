/**
 * Startup environment validation for Analytics Service - mirrors every other Tier 0 service's
 * fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today
 * (src/utils/tokens.ts's signAccessToken), not a JWKS scheme - identical reasoning to
 * jd-parser-service's config/env.ts: staff auth has not cut over to Identity Service yet. All
 * four routes this service exposes are recruiter/admin only.
 *
 * MONOLITH_INTERNAL_URL: this service owns nothing directly - every route proxies to the
 * monolith's new /internal/analytics/* API. Required, not graceful-null: an Analytics Service
 * that can't reach it has no reasonable way to serve any of its routes at all (Batch 22 domain
 * audit - analytics.routes.ts's four routes are pure SQL aggregation over swipes/jobs/candidates/
 * users, none of which this service owns or could sensibly own a copy of).
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4010', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';

const REQUIRED_ALWAYS = ['MONOLITH_INTERNAL_URL'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for analytics-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
