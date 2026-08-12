/**
 * The Gateway's routing table - the strangler-fig fallback mechanism itself (Phase 11 section 12).
 * Every path already migrated to a Tier 0 service is matched explicitly and forwarded there;
 * everything else falls through to the monolith unchanged, which is what lets the frontend keep
 * working with zero changes as more of the system migrates in later batches (Phase 1's
 * requirement, referenced throughout every prior batch).
 *
 * Uses http-proxy-middleware's `pathFilter` (not Express's `app.use(path, ...)` prefix mounting)
 * deliberately: Express strips the mount path from `req.url` before a mounted middleware ever
 * sees it, which would forward `/api/auth/login` to the target as just `/login` - wrong, since
 * every Tier 0 service's own routes are mounted at the FULL path already (identity-service's
 * server.ts: "so this service's real paths... are byte-identical to the monolith's today... the
 * Gateway can reverse-proxy /api/auth/* straight through with no path rewriting needed").
 * `pathFilter` matches without stripping, so the full original path is forwarded as-is.
 *
 * /internal/* is explicitly rejected here, never proxied anywhere - every Tier 0 service's own
 * internal routes document a network-boundary trust model (no JWT, no rate limiting beyond this
 * Gateway), and the Gateway is the actual place that boundary is enforced in a real deployment.
 * Relying on the monolith fallback to 404 that path by coincidence would be an implicit, fragile
 * guarantee; this is an explicit one.
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Express, Request, Response, NextFunction } from 'express';
import { IDENTITY_SERVICE_URL, PLATFORM_GOVERNANCE_SERVICE_URL, JD_PARSER_SERVICE_URL, CANDIDATE_SERVICE_URL, CHAT_SERVICE_URL, RESUME_SERVICE_URL, RECRUITING_SERVICE_URL, ANALYTICS_SERVICE_URL, MATCHING_EVALUATION_SERVICE_URL, MATCHING_SKILL_DISCOVERY_SERVICE_URL, MATCHING_SCORING_SERVICE_URL, CANDIDATE_CORE_SERVICE_URL, JOB_SERVICE_URL, MATCHING_DECISION_SERVICE_URL, MONOLITH_URL, MONOLITH_FALLBACK_ENABLED, CANARY_PERCENTAGE } from './config/env.js';
import { logger } from './utils/logger.js';
import { proxiedRequestCount } from './utils/metrics.js';
import { authLimiter, globalLimiter } from './middleware/rateLimit.middleware.js';
import * as crypto from 'crypto';

// Auth-sensitive surfaces (credential testing, OTP, registration) get the stricter authLimiter;
// everything else gets globalLimiter only - see rateLimit.middleware.ts's header comment.
const AUTH_SENSITIVE_PREFIXES = ['/api/auth', '/api/candidate-auth', '/api/company-registration'];

// Production canary: determine if a request should be routed through canary path
// Uses hash of user ID or session ID for consistent routing - same user always routes the same way
function isInCanaryPercentage(req: Request): boolean {
  if (CANARY_PERCENTAGE >= 100) return true; // All traffic in canary path once at 100%
  if (CANARY_PERCENTAGE <= 0) return false;  // No canary traffic if 0%

  // Use Authorization header or IP + user-agent as hash source for consistent routing
  const hashSource = req.headers.authorization || `${req.ip}:${req.get('user-agent')}`;
  const hash = crypto.createHash('md5').update(hashSource).digest('hex');
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const percentage = (hashValue % 100) + 1; // 1-100 range

  return percentage <= CANARY_PERCENTAGE;
}

function isUnderAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// A route normally matches its own prefix AND any sub-path (isUnderAnyPrefix above) - the same
// exact-segment behavior '/api/jobs/parse-description' already relies on to avoid catching
// unrelated '/api/jobs/*' paths. '/api/matches' (Batch 19) needs something stricter: Recruiting
// Service's own '/api/matches' (mutual-match lists, a different bounded context) must not swallow
// '/api/matches/queue/:job_id' and '/api/matches/score', which START WITH '/api/matches/' and now
// belong to Matching Decision Service (Remaining-monolith migration, Step 6 - see below).
// `exact: true` restricts Recruiting Service's own route to matching only the literal path, never
// any sub-path, so the two sibling '/api/matches/*' leaves route independently and correctly.
function matchesRoute(path: string, route: { prefix: string; exact?: boolean }): boolean {
  return route.exact ? path === route.prefix : isUnderAnyPrefix(path, [route.prefix]);
}

function proxyTo(target: string, name: string) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      proxyRes: (proxyRes, req) => {
        proxiedRequestCount.inc({ target: name, method: req.method, status_code: String(proxyRes.statusCode) });
      },
      error: (err, req, res) => {
        logger.error({ err: err.message, target: name, path: req.url }, 'Upstream proxy error');
        if (res && 'writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `${name} is currently unavailable. Please try again.` }));
        }
      },
    },
  });
}

const ROUTES: { prefix: string; target: string; name: string; exact?: boolean }[] = [
  { prefix: '/api/auth', target: IDENTITY_SERVICE_URL, name: 'identity-service' },
  { prefix: '/api/candidate-auth', target: IDENTITY_SERVICE_URL, name: 'identity-service' },
  // Development test endpoints - only active in non-production mode
  { prefix: '/api/test', target: IDENTITY_SERVICE_URL, name: 'identity-service' },
  // Batch 21 - staff user management (admin CRUD on recruiters within their own company), added
  // to Identity Service since it already owns users/refresh_tokens/password_history in full.
  { prefix: '/api/users', target: IDENTITY_SERVICE_URL, name: 'identity-service' },
  { prefix: '/api/company-registration', target: PLATFORM_GOVERNANCE_SERVICE_URL, name: 'platform-governance-service' },
  { prefix: '/api/admin/company-requests', target: PLATFORM_GOVERNANCE_SERVICE_URL, name: 'platform-governance-service' },
  // Listed BEFORE the broader '/api/jobs' entry below (Remaining-monolith migration, Step 4) -
  // ROUTES is matched in array order, first match wins, so this narrower leaf path claims itself
  // before the broader prefix ever gets a chance to swallow it (same ordering-based collision
  // guard already used for '/api/ml/train/ranking' before '/api/ml/train').
  { prefix: '/api/jobs/parse-description', target: JD_PARSER_SERVICE_URL, name: 'jd-parser-service' },
  // Job Service (Remaining-monolith migration, Step 4) - GET /api/jobs/:id is a real cutover
  // (own DB + candidate-core-service + matching-scoring-service, no monolith call); list/create/
  // update/delete proxy through to the monolith internally (job-service's own concern, transparent
  // to the Gateway) - see job-service/src/config/env.ts's header comment.
  { prefix: '/api/jobs', target: JOB_SERVICE_URL, name: 'job-service' },
  // Candidate Service (Batch 16) - the candidate self-service bounded context. Deliberately NOT
  // '/api/candidate' as a single broad prefix: candidate-auth (already routed to Identity Service
  // above, unchanged), candidate-resume, and candidate-search are distinct path prefixes that are
  // never listed here, so each falls through by the same exact-segment matching that protects
  // '/api/jobs/parse-description' above - to Identity Service for candidate-auth (its own earlier
  // rule, listed first).
  { prefix: '/api/candidate-profile', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  { prefix: '/api/candidate-jobs', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  { prefix: '/api/candidate-applications', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  { prefix: '/api/candidate-decisions', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  { prefix: '/api/candidate-matches', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  // Batch 20 - candidate_notifications now lives in Candidate Service's own database (extending
  // its Batch 16 scope, not a new service - see candidate-service/README.md).
  { prefix: '/api/candidate-notifications', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  // Remaining-monolith migration, Step 3c - folded into Candidate Service (not analytics-service,
  // a different bounded context - see analytics-service's own comment below), same "extend an
  // existing service's scope" precedent as candidate_notifications above.
  { prefix: '/api/candidate-analytics', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  // Remaining-monolith migration, Step 5 - folded into Candidate Service, NOT Candidate Core
  // Service (the plan document's original guess) - candidate-search.routes.ts's own queries read
  // candidate_accounts, which Candidate Service has owned outright since Batch 16, a different
  // table entirely from Candidate Core Service's `candidates` (recruiter-uploaded resumes). Real
  // cutover for search/tabs/save/profile-view; GET tab/shortlisted proxies through to the monolith
  // internally (candidate-service's own concern, transparent to the Gateway) - see
  // candidate-service/src/config/env.ts's header comment.
  { prefix: '/api/candidate-search', target: CANDIDATE_SERVICE_URL, name: 'candidate-service' },
  // Candidate Core Service (Remaining-monolith migration, Step 3a) - the recruiter-facing
  // candidate database, a DIFFERENT bounded context from Candidate Service above (self-service
  // login/profile). Deliberately '/api/candidates' (no hyphen) - never collides with any
  // 'candidate-*' prefix above, real distinct literal strings.
  { prefix: '/api/candidates', target: CANDIDATE_CORE_SERVICE_URL, name: 'candidate-core-service' },
  { prefix: '/api/bulk-upload-candidates', target: CANDIDATE_CORE_SERVICE_URL, name: 'candidate-core-service' },
  // Chat Service (Batch 17). Covers both POST /api/chat and POST /api/chat/reindex - same prefix,
  // no separate entry needed.
  { prefix: '/api/chat', target: CHAT_SERVICE_URL, name: 'chat-service' },
  // Resume Service (Batch 18) - both the candidate-facing surface and the recruiter-facing bulk
  // upload path, which share the same parsing pipeline (candidate-resume.routes.ts imported a
  // helper directly from upload.routes.ts before this extraction - see the Batch 15/16 audit's
  // "Resume + File" finding).
  { prefix: '/api/candidate-resume', target: RESUME_SERVICE_URL, name: 'resume-service' },
  { prefix: '/api/parse-resume', target: RESUME_SERVICE_URL, name: 'resume-service' },
  // Recruiting Service (Batch 19) - a deliberately partial extraction (recruiter-matches +
  // recruiter-notifications only; see recruiting-service/README.md's "Why this extraction is
  // partial"). '/api/matches' is EXACT ONLY - see matchesRoute's header comment above for why a
  // plain prefix would wrongly also capture Matching Decision Service's own sibling leaves below.
  { prefix: '/api/matches', target: RECRUITING_SERVICE_URL, name: 'recruiting-service', exact: true },
  { prefix: '/api/recruiter-notifications', target: RECRUITING_SERVICE_URL, name: 'recruiting-service' },
  // Matching Decision Service (Remaining-monolith migration, Step 6) - the AI Match queue/score/
  // swipe-record/history/stats surface, a different bounded context from Recruiting Service's own
  // exact '/api/matches' above (mutual-match lists). GET /api/matches/queue/:job_id,
  // POST /api/matches/score, GET /api/swipes/history, and GET /api/swipes/stats are real cutovers
  // (own swipes mirror + job-service/candidate-core-service/matching-scoring-service fan-out);
  // POST /api/swipes and every /api/recruiter-review* route proxy through to the monolith
  // internally (this service's own concern, transparent to the Gateway) - see matching-decision-
  // service/src/config/env.ts's header comment.
  { prefix: '/api/matches/queue', target: MATCHING_DECISION_SERVICE_URL, name: 'matching-decision-service' },
  { prefix: '/api/matches/score', target: MATCHING_DECISION_SERVICE_URL, name: 'matching-decision-service' },
  { prefix: '/api/swipes', target: MATCHING_DECISION_SERVICE_URL, name: 'matching-decision-service' },
  { prefix: '/api/recruiter-review', target: MATCHING_DECISION_SERVICE_URL, name: 'matching-decision-service' },
  // Analytics Service (Batch 22) - recruiter/admin dashboard analytics only, a pure proxy (this
  // service owns no database). Deliberately NOT '/api/analytics' as a broader claim on anything
  // that starts with "analytics" - candidate-analytics (Candidate Service, a different bounded
  // context - see above) and proficiency-analytics/shadow-data-health (Matching Evaluation
  // Service, below) are distinct path prefixes, never listed here, so each falls through by the
  // same exact-segment matching that protects every other narrow route in this table.
  { prefix: '/api/analytics', target: ANALYTICS_SERVICE_URL, name: 'analytics-service' },
  // Matching Evaluation Service (Batch 24) - exactly the 3 ml.routes.ts leaf paths this service
  // owns. '/api/ml/evaluate' (prefix) catches '/api/ml/evaluate' and '/api/ml/evaluate/history' via
  // the usual sub-path matching but nothing else; '/api/ml/train/ranking' does NOT match
  // '/api/ml/train' (not a sub-path of it, and registered first below regardless); '/api/ml/ranking/status'
  // is a unique leaf.
  { prefix: '/api/ml/evaluate', target: MATCHING_EVALUATION_SERVICE_URL, name: 'matching-evaluation-service' },
  { prefix: '/api/ml/train/ranking', target: MATCHING_EVALUATION_SERVICE_URL, name: 'matching-evaluation-service' },
  { prefix: '/api/ml/ranking/status', target: MATCHING_EVALUATION_SERVICE_URL, name: 'matching-evaluation-service' },
  // Matching Scoring Service (Remaining-monolith migration, Step 1) - the other 4 ml.routes.ts leaf
  // paths, the ones matching-evaluation-service's own comment above named as staying on the
  // monolith until now. '/api/ml/train' uses `exact: true` deliberately - without it, a plain
  // prefix match would ALSO capture '/api/ml/train/ranking' (a sub-path of '/api/ml/train/'),
  // wrongly stealing traffic that must keep going to matching-evaluation-service above.
  { prefix: '/api/ml/config', target: MATCHING_SCORING_SERVICE_URL, name: 'matching-scoring-service' },
  { prefix: '/api/ml/train', target: MATCHING_SCORING_SERVICE_URL, name: 'matching-scoring-service', exact: true },
  { prefix: '/api/ml/model/status', target: MATCHING_SCORING_SERVICE_URL, name: 'matching-scoring-service' },
  { prefix: '/api/ml/model/versions', target: MATCHING_SCORING_SERVICE_URL, name: 'matching-scoring-service' },
  // Matching Evaluation Service, extended (Batch 25) - the two shadow-analytics reporting routes,
  // now served directly from this service's own dual-written proficiency_shadow_scores mirror.
  // Distinct leaf paths, exactly as anticipated by the Analytics Service comment above - neither
  // collides with '/api/analytics' (different first segment) or anything else in this table.
  { prefix: '/api/proficiency-analytics', target: MATCHING_EVALUATION_SERVICE_URL, name: 'matching-evaluation-service' },
  { prefix: '/api/shadow-data-health', target: MATCHING_EVALUATION_SERVICE_URL, name: 'matching-evaluation-service' },
  // Matching Skill Discovery Service (reusing the existing Batch 27 service - see
  // config/env.ts's header comment). Covers /api/skills/discovery/pending,
  // /api/skills/discovery/:id/approve, /api/skills/discovery/:id/reject.
  { prefix: '/api/skills/discovery', target: MATCHING_SKILL_DISCOVERY_SERVICE_URL, name: 'matching-skill-discovery-service' },
];

export function mountProxyRoutes(app: Express): void {
  // Explicit safety net - see header comment. Registered first, before any proxy target.
  app.use('/internal', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  for (const route of ROUTES) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (!matchesRoute(req.path, route)) return next();
      const limiter = isUnderAnyPrefix(req.path, AUTH_SENSITIVE_PREFIXES) ? authLimiter : globalLimiter;
      limiter(req, res, (err?: unknown) => {
        if (err) return next(err);
        proxyTo(route.target, route.name)(req, res, next);
      });
    });
  }

  // Strangler-fig fallback: every path not explicitly matched above goes to the monolith
  // unchanged - this is what keeps the frontend working with zero changes for everything not yet
  // migrated to Tier 0 (recruiting, matching, jobs, candidates, analytics, static assets, etc.).
  //
  // Production Canary: CANARY_PERCENTAGE controls gradual rollout (10% → 25% → 50% → 100%)
  // - If in canary percentage: use microservice-only path (no fallback, stricter)
  // - If not in canary percentage: allow fallback (if enabled, more lenient)
  // This allows gradual rollout by slowly increasing traffic through the proven path.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const inCanary = isInCanaryPercentage(req);
    const canaryMode = CANARY_PERCENTAGE < 100;

    // In production canary: route based on canary percentage
    if (canaryMode) {
      if (inCanary) {
        // In canary path: use microservice-only (stricter, no fallback)
        res.status(404).json({
          error: 'Not found (canary path - microservices only, no fallback)',
          canary: { percentage: CANARY_PERCENTAGE, userInCanary: true },
        });
      } else {
        // Not in canary path: allow fallback if enabled
        if (MONOLITH_FALLBACK_ENABLED) {
          globalLimiter(req, res, (err?: unknown) => {
            if (err) return next(err);
            proxyTo(MONOLITH_URL, 'monolith')(req, res, next);
          });
        } else {
          res.status(404).json({
            error: 'Not found (monolith fallback disabled)',
            canary: { percentage: CANARY_PERCENTAGE, userInCanary: false },
          });
        }
      }
    } else {
      // Not in canary mode: standard behavior
      if (MONOLITH_FALLBACK_ENABLED) {
        globalLimiter(req, res, (err?: unknown) => {
          if (err) return next(err);
          proxyTo(MONOLITH_URL, 'monolith')(req, res, next);
        });
      } else {
        res.status(404).json({ error: 'Not found (monolith fallback disabled)' });
      }
    }
  });
}
