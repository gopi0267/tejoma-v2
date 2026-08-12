/**
 * Startup environment validation for Matching Skill Discovery Service - mirrors every other Tier 0
 * service's fail-fast convention.
 *
 * JWT_SECRET: verifies the same HS256 staff token the monolith issues today
 * (src/utils/tokens.ts's signAccessToken) - this service's own /api/skills/discovery/* routes are
 * staff-facing (recruiter/admin), same reasoning as jd-parser-service's/chat-service's/
 * matching-evaluation-service's config/env.ts: staff auth has not cut over to Identity Service yet.
 *
 * MONOLITH_INTERNAL_URL: required, not graceful-null - promotion (auto or human-approved) has no
 * safe fallback without it, since this service never writes skill_nodes/skill_edges itself (see
 * db.ts's header comment) and must proxy that one write to the monolith's new
 * /internal/skill-discovery/promote endpoint.
 *
 * GEMINI_API_KEY: optional/graceful-null, NOT required - preserves the monolith's own
 * unknownSkillDiscovery.ts behavior exactly (classifyToken already returns null and queues the
 * token for manual review when this is unset, rather than crashing - see that file's
 * getGeminiClient header comment). Making it required here would be a real behavior change,
 * forbidden by this batch's own preserve-existing-functionality rule.
 *
 * MATCHING_ML_SERVICE_URL: the Python BERT embedding service - called directly by this service's
 * own findNearestNeighbors, never through the monolith, same as matching-reasoning-service's copy
 * of this client. Optional/graceful-null - not required at startup.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4013', 10);

// Identity Service's RS256 public key - staff access tokens are issued by Identity Service and
// verified here. JWT_SECRET below is retained only for any remaining legacy/internal use.
export const IDENTITY_JWT_PUBLIC_KEY = process.env.IDENTITY_JWT_PUBLIC_KEY || '';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
export const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';


// MONOLITH_INTERNAL_URL is no longer REQUIRED: the monolith was decommissioned 2026-08-12 and is
// not part of the deployment. It stays an optional env var so the documented rollback (restore the
// app service and set this) works without a code change. Every remaining monolithClient call in
// this service is rollback-only fire-and-forget or dead code, verified non-blocking with the
// monolith stopped - see TEJOMA_FINAL_MICROSERVICES_DECOMMISSION_REPORT.md.
const REQUIRED_ALWAYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'];

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  fatal.push('JWT_SECRET');
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for matching-skill-discovery-service. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
