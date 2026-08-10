/**
 * Startup environment validation for JD Parser Service - mirrors every other Tier 0 service's
 * fail-fast convention, with one deliberate deviation worth flagging.
 *
 * This service has no database (Phase 3(database) section 1 - the parsing pipeline is a pure
 * function of its input text, confirmed by the Batch 15 domain audit: zero DB access anywhere in
 * src/jd-parser/). So there is no DB_* requirement here, unlike every DB-owning Tier 0 service.
 *
 * JWT_SECRET: this service verifies the SAME token the monolith issues today
 * (src/utils/tokens.ts's HS256/shared-secret scheme), not the RS256/JWKS scheme
 * platform-governance-service's staffAuth.middleware.ts uses. That's not an oversight - staff auth
 * has not cut over to Identity Service yet (MIGRATION_RUNBOOK.md section 5: "the actual traffic
 * flip has never been executed"), so every real session cookie in production today is still an
 * HS256 token signed with the monolith's JWT_SECRET. Verifying against Identity Service's JWKS
 * here would reject every currently valid session. Once auth itself cuts over, this can switch to
 * the same jwks-rsa pattern platform-governance-service already uses - not before, or this service
 * would be unusable from day one. The dev-only fallback below deliberately mirrors
 * src/utils/tokens.ts's own fallback (same string) rather than introducing a stricter or laxer
 * default for the same secret.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4004', 10);

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// Optional and gracefully-degrading by design (src/jd-parser/tiers/nlpTier.ts) - a down or
// unconfigured NLP service must never break JD parsing, so it is not in REQUIRED_ALWAYS.
export const JD_NLP_SERVICE_URL = process.env.JD_NLP_SERVICE_URL || 'http://localhost:8008';

const REQUIRED_ALWAYS: string[] = [];
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  // Only fatal in production - the shared dev fallback above is deliberately allowed locally,
  // exactly matching the monolith's own src/utils/tokens.ts risk posture for this same secret.
  REQUIRED_ALWAYS.push('JWT_SECRET');
}

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for jd-parser-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
