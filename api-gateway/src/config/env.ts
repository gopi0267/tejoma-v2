/**
 * Startup environment validation for API Gateway - mirrors every other Tier 0 service's
 * fail-fast convention, minus any DB_* requirement: the Gateway is the one Tier 0 service with no
 * database of its own (Phase 3(database) section 1 - it owns no data, only routes to what does).
 *
 * All three upstream targets are required at startup, not graceful-null: unlike a soft enrichment
 * call (tenantDirectoryClient.ts's getCompanyById), a Gateway that doesn't know where to send a
 * request has no reasonable request to serve at all. IDENTITY_SERVICE_URL and
 * PLATFORM_GOVERNANCE_SERVICE_URL route the paths already migrated to Tier 0 (Batches 4-11).
 * MONOLITH_URL is the strangler-fig fallback (Phase 11 section 12) - every path not explicitly
 * matched below falls through to it, which is how the frontend keeps working unchanged for
 * every route not yet migrated (recruiting, matching, jobs, candidates, analytics, and all static
 * frontend assets).
 *
 * JD_PARSER_SERVICE_URL (Batch 15) and CANDIDATE_SERVICE_URL (Batch 16) are required for the same
 * reason: unlike Tenant Directory Service (cutover-by-configuration, never routed to directly),
 * both are called directly by the frontend, so the Gateway has no reasonable request to serve for
 * those paths without knowing where to send them. Note Candidate Service does NOT take every
 * "/api/candidate-" prefixed path: candidate-auth was already routed to Identity Service by an
 * earlier batch (unchanged here); candidate-resume, candidate-notifications, candidate-search,
 * and candidate-analytics all still belong to the monolith (Batch 16 domain audit's explicit
 * scope) and fall through via the strangler-fig default below unchanged.
 *
 * RECRUITING_SERVICE_URL (Batch 19) - same reasoning: called directly by the frontend for
 * /api/recruiter-notifications and /api/matches. Note /api/matches is routed with an EXACT match,
 * not a prefix - proxy.ts's ROUTES entry for it sets `exact: true` because swipe.routes.ts's
 * /api/matches/queue/:job_id and /api/matches/score (staying on the monolith - Matching domain,
 * not yet extracted) would otherwise also match a plain '/api/matches' prefix.
 *
 * ANALYTICS_SERVICE_URL (Batch 22) - same reasoning: called directly by the frontend for
 * /api/analytics/*. Note candidate-analytics/proficiency-analytics/shadow-data-health are
 * DIFFERENT path prefixes, never routed here - both still belong to the monolith (Batch 22
 * domain audit: both call the live matching/shadow-scoring engine directly).
 *
 * MATCHING_EVALUATION_SERVICE_URL (Batch 24) - same reasoning: called directly by the frontend for
 * three specific ml.routes.ts leaf paths (/api/ml/evaluate[/history], /api/ml/train/ranking,
 * /api/ml/ranking/status). The other /api/ml/* paths (/config, /train, /model/status,
 * /model/versions) stay on the monolith - deliberately narrow prefixes in proxy.ts's ROUTES, not
 * a blanket '/api/ml' claim.
 *
 * MATCHING_SKILL_DISCOVERY_SERVICE_URL (Full-migration batch, reusing Batch 27's existing service)
 * - /api/skills/discovery/* was already fully built and validated on matching-skill-discovery-
 * service since Batch 27 (byte-identical to the monolith's skill-intelligence.routes.ts) but never
 * gateway-routed - this closes that gap by reusing the existing service rather than duplicating it
 * into a new one, per the explicit "reuse existing services" migration requirement.
 *
 * MATCHING_SCORING_SERVICE_URL (Remaining-monolith migration, Step 1) - the 4 ml.routes.ts leaf
 * paths MATCHING_EVALUATION_SERVICE_URL's comment above named as still monolith-owned
 * (/api/ml/config, /api/ml/train, /api/ml/model/status, /api/ml/model/versions) now route here -
 * matching-scoring-service already owned the underlying activeModelType/ensemble-health state
 * being surfaced, it just never had a public HTTP front door before. /api/ml/train uses `exact:
 * true` in proxy.ts's ROUTES - '/api/ml/train/ranking' is a different, sibling leaf that must keep
 * routing to matching-evaluation-service, not get swallowed by a plain '/api/ml/train' prefix
 * match.
 *
 * CANDIDATE_CORE_SERVICE_URL (Remaining-monolith migration, Step 3a) - '/api/candidates' (no
 * hyphen - the recruiter-facing candidate database, distinct from Candidate Service's
 * 'candidate-*' self-service prefixes above) and '/api/bulk-upload-candidates'. GET reads are a
 * real cutover (served from this service's own already-fresh mirror); writes proxy through to the
 * monolith internally (candidate-core-service's own concern, transparent to the Gateway) - see
 * candidate-core-service/src/config/env.ts's header comment.
 *
 * JOB_SERVICE_URL (Remaining-monolith migration, Step 4) - '/api/jobs', listed AFTER
 * '/api/jobs/parse-description' in proxy.ts's ROUTES so that narrower leaf path keeps winning by
 * array-order precedence (same pattern as MATCHING_SCORING_SERVICE_URL's '/api/ml/train' vs
 * '/api/ml/train/ranking'). GET /api/jobs/:id is job-service's own real cutover; everything else
 * proxies through to the monolith internally, transparent to the Gateway.
 *
 * MATCHING_DECISION_SERVICE_URL (Remaining-monolith migration, Step 6) - '/api/matches/queue',
 * '/api/matches/score', '/api/swipes', '/api/recruiter-review'. GET /api/matches/queue/:job_id,
 * POST /api/matches/score, GET /api/swipes/history, and GET /api/swipes/stats are real cutovers;
 * POST /api/swipes and every /api/recruiter-review* route proxy through to the monolith
 * internally, transparent to the Gateway. Distinct from Recruiting Service's own EXACT
 * '/api/matches' (mutual-match lists) - see proxy.ts's matchesRoute header comment.
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = parseInt(process.env.PORT || '4000', 10);

export const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || '';
export const PLATFORM_GOVERNANCE_SERVICE_URL = process.env.PLATFORM_GOVERNANCE_SERVICE_URL || '';
export const JD_PARSER_SERVICE_URL = process.env.JD_PARSER_SERVICE_URL || '';
export const CANDIDATE_SERVICE_URL = process.env.CANDIDATE_SERVICE_URL || '';
export const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || '';
export const RESUME_SERVICE_URL = process.env.RESUME_SERVICE_URL || '';
export const RECRUITING_SERVICE_URL = process.env.RECRUITING_SERVICE_URL || '';
export const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || '';
export const MATCHING_EVALUATION_SERVICE_URL = process.env.MATCHING_EVALUATION_SERVICE_URL || '';
export const MATCHING_SKILL_DISCOVERY_SERVICE_URL = process.env.MATCHING_SKILL_DISCOVERY_SERVICE_URL || '';
export const MATCHING_SCORING_SERVICE_URL = process.env.MATCHING_SCORING_SERVICE_URL || '';
export const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || '';
export const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || '';
export const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || '';
export const MONOLITH_URL = process.env.MONOLITH_URL || '';
// Defaults to true for backwards compatibility, but is force-disabled when MONOLITH_URL is empty.
// Without that guard, unsetting MONOLITH_FALLBACK_ENABLED after the monolith's decommission would
// make the gateway proxy unmatched paths to an empty target - producing connection errors instead
// of the clean 404 the strangler-fig fallback is supposed to degrade to. Fallback is only
// meaningful when there is something to fall back TO.
export const MONOLITH_FALLBACK_ENABLED =
  process.env.MONOLITH_FALLBACK_ENABLED !== 'false' && !!(process.env.MONOLITH_URL || '').trim();

// Production canary: percentage of traffic routed through microservice-only path (0-100)
// 100 = all traffic through microservices (full cutover)
// 10 = 10% through microservices, 90% through fallback (early canary)
// Default 100 for production once canary is verified
export const CANARY_PERCENTAGE = parseInt(process.env.CANARY_PERCENTAGE || '100', 10);
if (isNaN(CANARY_PERCENTAGE) || CANARY_PERCENTAGE < 0 || CANARY_PERCENTAGE > 100) {
  console.error(`\nFATAL: CANARY_PERCENTAGE must be 0-100, got ${process.env.CANARY_PERCENTAGE}`);
  process.exit(1);
}

const REQUIRED_ALWAYS = ['IDENTITY_SERVICE_URL', 'PLATFORM_GOVERNANCE_SERVICE_URL', 'JD_PARSER_SERVICE_URL', 'CANDIDATE_SERVICE_URL', 'CHAT_SERVICE_URL', 'RESUME_SERVICE_URL', 'RECRUITING_SERVICE_URL', 'ANALYTICS_SERVICE_URL', 'MATCHING_EVALUATION_SERVICE_URL', 'MATCHING_SKILL_DISCOVERY_SERVICE_URL', 'MATCHING_SCORING_SERVICE_URL', 'CANDIDATE_CORE_SERVICE_URL', 'JOB_SERVICE_URL', 'MATCHING_DECISION_SERVICE_URL'];
// MONOLITH_URL deliberately NOT required: the monolith was decommissioned 2026-08-12 and is no
// longer part of the deployment. It remains an optional env var purely so the documented rollback
// (set MONOLITH_FALLBACK_ENABLED=true and restore the app service) still works without a code
// change - the fallback branch in proxy.ts is unchanged. With the monolith gone, MONOLITH_URL
// resolves to '' and MONOLITH_FALLBACK_ENABLED is false, so nothing can route there.

const fatal: string[] = [];

for (const key of REQUIRED_ALWAYS) {
  if (!process.env[key]) fatal.push(key);
}

if (fatal.length > 0) {
  console.error(
    '\nFATAL: invalid environment configuration for api-gateway. Refusing to start.\n' +
      fatal.map((k) => `  - ${k}`).join('\n') +
      '\n'
  );
  process.exit(1);
}
