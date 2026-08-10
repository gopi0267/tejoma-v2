# Tier 0 Migration Runbook: Backfill → Dual-Write → Shadow-Read → Validate → Cutover → Rollback

This is the operational procedure for moving real traffic from the monolith to the four Tier 0
services (Identity Service, Platform Governance Service, Tenant Directory Service, API Gateway),
following the strangler-fig methodology used throughout this migration series. It assumes you've
read each service's own README for what it does - this document is about the *sequence of
operator actions*, not the architecture.

**Status as of this writing:** backfill and dual-write are built and verified working (disabled by
default). Shadow-read is built and verified for staff login only. The actual cutover step (§4) and
rollback step (§5) are **not yet executed against real traffic** - nothing in this repository has
performed them. §6 (infra prerequisites) is explicitly **not done yet** and is a hard blocker for
§4.

---

## 0. What "cutover" means here

Today, all real traffic hits the monolith directly (nginx → monolith, per `DEPLOYMENT.md`).
Cutover means: nginx (or, once built, an ALB) starts routing to API Gateway instead, and API
Gateway's own routing table (`api-gateway/src/proxy.ts`) sends `/api/auth/*`, `/api/candidate-auth/*`,
`/api/company-registration`, and `/api/admin/company-requests/*` to the new services, falling
through to the monolith for everything else. Nothing about the frontend changes - same paths, same
request/response shapes (Phase 1's zero-frontend-change requirement, verified throughout every
batch of this series).

Cutover is a **path-by-path decision**, not all-or-nothing: you can cut over `/api/auth/*` while
everything else still falls through to the monolith, and watch it before cutting over the next
path.

---

## 1. Pre-cutover checklist

Run through this in order. Do not proceed to §4 until every item passes.

### 1.1 Fresh backfill

```bash
npx tsx scripts/backfill-identity-service.ts
npx tsx scripts/backfill-tenant-directory-service.ts
npx tsx scripts/backfill-platform-governance-service.ts
```

Safe to re-run any time (idempotent, upserts by id). Run this again immediately before §4, no
matter how recently it last ran.

### 1.2 Validate zero drift

```bash
npx tsx scripts/validate-identity-service-sync.ts
npx tsx scripts/validate-tenant-directory-service-sync.ts
npx tsx scripts/validate-platform-governance-service-sync.ts
```

All three must print `✓ ... is fully in sync with the monolith.` and exit 0. If any reports a
mismatch, **stop** - do not proceed until it's resolved (re-run the matching backfill script first;
if that doesn't clear it, the mismatch is a real bug, not a staleness issue).

### 1.3 Enable dual-write, let it run, re-validate

Set `DUAL_WRITE_ENABLED=true` (plus `IDENTITY_DB_NAME`/`TENANT_DIRECTORY_DB_NAME`/
`PLATFORM_GOVERNANCE_DB_NAME` if they differ from the defaults) on the monolith process and
restart it. From this point, every write to the 7 migrated tables mirrors to the new databases in
real time (see `src/dualWrite.ts`'s header comment for exactly which write paths are covered, and
which are deliberately not).

Let it run under real traffic for a meaningful period (long enough to see a representative mix of
logins, password resets, registrations, approvals - a few days minimum, not a few minutes). Then
re-run §1.2. It should still be clean. If it isn't, dual-write has a bug - fix it before proceeding
(do not cut over with dual-write silently failing, since cutover assumes the new database is
current).

Watch the monolith's logs for `Dual-write failed` entries (`src/dualWrite.ts`'s `safeWrite`) - any
occurrence means a target database was unreachable for that write. Isolated transient entries are
tolerable (re-run backfill to catch up); a sustained stream means something is wrong with a target
database's availability and must be fixed first.

### 1.4 Enable shadow-read on staff login, watch for divergence

Set `SHADOW_READ_ENABLED=true` and `IDENTITY_SERVICE_URL` on the monolith process (restart
required). Every real `POST /auth/login` now also asks Identity Service the same question after
already responding to the real user, and logs agreement/divergence (`src/shadowRead.ts`).

Watch logs for `SHADOW-READ DIVERGENCE` (logged at `error`). **Zero divergence over a real traffic
period is the actual gate for trusting Identity Service's login logic** - this is what catches a
correctness bug that data-sync validation (§1.2) cannot, since it's about business logic on read,
not row equality. Any divergence is a real bug: stop and fix it before cutting over `/api/auth/*`.

Shadow-read currently only covers staff login. Before cutting over `/api/candidate-auth/*`, extend
`src/shadowRead.ts` with a `shadowReadCandidateLogin` following the identical pattern (see that
file's header comment) and repeat this step for it.

### 1.5 API Gateway itself

Confirm API Gateway is deployed and its own health check is green (`GET /health` reports all three
upstreams `ok`), and that its rate limits (`api-gateway/src/middleware/rateLimit.middleware.ts`)
are set to real production values, not the tiny test overrides used in its own test suite.

---

## 2. Order of cutover

Cut over in this order - each one depends on the previous being stable:

1. **Tenant Directory Service reads** - already effectively live the moment
   `TENANT_DIRECTORY_SERVICE_URL` is set on Identity Service and Platform Governance Service (both
   already call it gracefully; see their own `tenantDirectoryClient.ts`). No traffic routing
   change needed for this one - it's cutover-by-configuration, not cutover-by-routing.
2. **`/api/auth/*` and `/api/candidate-auth/*`** (Identity Service) - the highest-value, most
   thoroughly shadow-read-tested path.
3. **`/api/company-registration` and `/api/admin/company-requests/*`** (Platform Governance
   Service) - lower traffic volume, but includes the approve saga (the highest-complexity single
   operation in this migration - see `platform-governance-service/src/routes/
   company-requests.routes.ts`'s header comment).

## 3. What actually flips traffic (§4, not yet done)

This is the one step that touches shared, production-facing infrastructure (nginx config or an
ALB listener rule) - not a script in this repo, deliberately. Per this project's own standing
caution around actions with real blast radius, this step should be executed manually, by you,
watching the result, not automated into a script that could execute against a config you haven't
reviewed line-by-line.

1. Confirm §1 fully passes for the path you're cutting over.
2. Update nginx (or the ALB) to route the specific path prefix to API Gateway instead of the
   monolith. Leave every other path pointed at the monolith - API Gateway's own fallback rule
   (`api-gateway/src/proxy.ts`) sends non-matching paths back to the monolith anyway, but routing
   only the intended prefix through it at the infra layer too is the more conservative, reversible
   change.
3. Watch error rates and latency on that path for the new service (its own `/metrics` +
   Prometheus/Grafana, already running per `DEPLOYMENT.md`) for at least the time it takes to see
   a real burst of that traffic type - don't declare success after 30 seconds of quiet.
4. Only then move to the next path in §2's order.

## 4. Rollback

Because cutover is a routing change, not a data migration, rollback is symmetric and fast:

1. Revert the nginx/ALB routing change from §3 step 2 for the affected path - traffic goes back to
   the monolith immediately.
2. The monolith's own tables were never modified or deprecated during this migration (dual-write
   only ever *adds* mirrored writes to the new databases; it never stops writing to the monolith's
   own tables, which remain fully authoritative until you deliberately decide otherwise). So
   rollback requires no data restoration - the monolith's data was the source of truth the whole
   time and never stopped being written to.
3. Leave dual-write and shadow-read running (don't disable them) - investigate the divergence or
   incident with them still active, then retry cutover once fixed.

## 6. JD Parser Service (Batch 15) - the same methodology, applied to a stateless service

JD Parser Service is the first extraction beyond the original 4 Tier 0 services, and the first
one with no database - the pipeline is a pure function of its input text (Batch 15 domain audit).
That changes what a few of the steps above mean in practice, so it gets its own short section
rather than being silently folded into §1-§5 above, which assume a DB-owning service.

- **No backfill, no dual-write.** There is no data to copy or mirror - nothing in §1.1/§1.3 above
  applies. Skip straight to shadow-validation.
- **Shadow-validation** (`src/jdParserShadow.ts`, mirrors `src/shadowRead.ts`'s contract exactly):
  set `SHADOW_JD_PARSER_ENABLED=true` and `JD_PARSER_SERVICE_URL` on the monolith process and
  restart it. Every real `POST /api/jobs/parse-description` now also asks jd-parser-service to
  parse the same text after already responding to the real user, and logs agreement/divergence.
  Watch for `SHADOW-VALIDATION DIVERGENCE` (logged at `error`) over a real traffic period before
  trusting this service's output - same bar as shadow-read, even though the code was extracted as
  a verbatim copy, not rewritten: this is what actually proves that claim under real conditions
  (catches zod-version drift, JD_NLP_SERVICE_URL reachability differences, and timeout behavior
  that a byte-for-byte code diff can't).
- **Cutover** is the same path-by-path infra decision as §3: update nginx/ALB (or, once API
  Gateway is the real entry point, nothing further needed - `api-gateway/src/proxy.ts` already
  routes `POST /api/jobs/parse-description` to `JD_PARSER_SERVICE_URL`). The monolith's own
  `src/api/jd-parser.routes.ts` and `src/jd-parser/` stay fully intact and untouched until this
  has been stable in production for a real period - identical discipline to §4/§5 above.
- **Rollback** is identical in shape to §4 above: revert the routing change, traffic goes back to
  the monolith immediately, no data to restore (there never was any).

## 6b. Candidate Service (Batch 16) - a DB-owning service with a partial proxy

Candidate Service owns `candidate_accounts` (profile columns) and `candidate_experiences`
directly - real dual-write, real backfill, follow §1.1-§1.3 above exactly
(`scripts/backfill-candidate-service.ts`, `scripts/validate-candidate-service-sync.ts`,
`DUAL_WRITE_ENABLED=true`, `CANDIDATE_SERVICE_DB_NAME`). It does NOT own jobs, decisions,
applications, or matches - those routes proxy back to the monolith's new `/internal/candidate/*`
API (`src/api/candidate-internal.routes.ts`), so the same trust-and-verify posture from §6
applies to them too: an unmodified network hop, not a rewrite.

- **Shadow-validation** (`src/candidateShadow.ts`) covers `GET /candidate-profile/me` only - the
  one endpoint this service fully owns end-to-end. Set `SHADOW_CANDIDATE_ENABLED=true` and
  `CANDIDATE_SERVICE_URL` to enable. The proxied endpoints re-validate the monolith against
  itself through an extra hop if shadow-tested, so they're deliberately out of scope for this hook
  - `scripts/candidate-service-mismatch-report.ts` (below) is the better tool for those once real
    traffic exists.
- **Mismatch report**: `scripts/candidate-service-mismatch-report.ts` - a standalone auditing tool
  (distinct from the per-request shadow hook) that compares the monolith vs. Candidate Service for
  every active candidate at once, with real timing data, before a cutover decision. Rehearsed
  against a local stand-in (not real traffic) - see this batch's own report for the walkthrough.
- **Cutover**: same path-by-path infra decision as §3 - `api-gateway/src/proxy.ts` already routes
  `/api/candidate-profile`, `/api/candidate-jobs`, `/api/candidate-applications`,
  `/api/candidate-decisions`, `/api/candidate-matches`, `/api/candidate-notifications` (Batch 20 -
  see §6b-i below) to `CANDIDATE_SERVICE_URL`. `candidate-auth`/`candidate-resume`/
  `candidate-search`/`candidate-analytics` are explicitly NOT part of this service's scope and stay
  on the monolith (`candidate-auth` was already routed to Identity Service by an earlier batch).
- **Rollback**: identical shape to §4 - revert the routing change; the monolith's own tables were
  never modified or deprecated, so no data restoration is needed.

### 6b-i. Candidate Service, extended (Batch 20) - candidate_notifications

A follow-on to §6b, not a new service. Domain audit: `candidate-notifications.routes.ts` is
structurally identical to Recruiting Service's `recruiter-notifications.routes.ts` (Batch 19) -
same 4-route shape, zero Matching-domain coupling. It lands in Candidate Service rather than a new
service because its primary FK target, `candidate_accounts`, is already owned there (Batch 16) -
the one case in this migration series where a new table keeps a REAL foreign key instead of the
usual cross-service-FK-elimination pattern (`match_id`/`job_id` still get dropped, since
`mutual_matches`/`jobs` remain monolith-owned).

- **Owns directly**: `candidate_notifications` - `candidate-service/migrations/
  002_notifications.up.sql`, real dual-write reusing Candidate Service's EXISTING pool/database (no
  new `*_DB_NAME` env var). Two write sites mirror: `createMatchNotifications` (match-created rows)
  and `syncApplicationStatusFromRecruiterDecision` (application-status-changed rows, job_id-based,
  no match_id).
- **A real bug caught during validation**: the first migration attempt used the version string
  `'002_candidate_notifications'` (27 characters) against `schema_migrations.version
  VARCHAR(20)` and failed with "value too long for type character varying(20)" - caught by actually
  running the migration, not just reviewing the SQL. Fixed by renaming to `002_notifications.up/
  down.sql` (17 characters). The failed attempt rolled back cleanly (single `BEGIN`/`COMMIT`
  transaction) - confirmed via `\dt` before retrying, not assumed.
- **Cutover**: `api-gateway/src/proxy.ts` routes `/api/candidate-notifications` to
  `CANDIDATE_SERVICE_URL` (plain prefix match - no collision risk, unlike Batch 19's `/api/matches`,
  since no other file uses this path prefix).
- **Rollback**: identical shape to §4. `candidate-service/migrations/002_notifications.down.sql`
  only drops `candidate_notifications` - `candidate_accounts`/`candidate_experiences` and their own
  §6b rollback are untouched.

## 6c. Chat Service (Batch 17) - a DB-owning service with a two-way dependency

Chat Service owns `knowledge_base_chunks` directly (real dual-write from `db.ts`'s
`upsertKnowledgeChunk`/`deleteKnowledgeChunk`, real backfill via
`scripts/backfill-chat-service.ts`/`scripts/validate-chat-service-sync.ts`,
`CHAT_SERVICE_DB_NAME`). Unlike every prior service, this one also calls the monolith for reads
it never owned (candidate/job counts, unscoped candidate/job lists via
`src/api/chat-internal.routes.ts`) - the same "proxy what you don't own" pattern as Candidate
Service, applied here because the chat prompt treats those counts as authoritative and cannot
approximate them from its own knowledge-base sample.

- **Shadow-validation is structurally different here, deliberately.** `src/chatShadow.ts` never
  compares the generated reply text - chat responses are LLM output (temperature 0.3), so two
  correct calls with an identical prompt will not produce identical wording. It compares the
  `sources` array (which knowledge-base chunks were retrieved) instead, which IS deterministic.
  Set `SHADOW_CHAT_ENABLED=true` and `CHAT_SERVICE_URL` to enable. Treat a `reply`-text mismatch
  as a non-event; treat a `sources` mismatch exactly like any other shadow divergence.
- **Cutover**: `api-gateway/src/proxy.ts` already routes `/api/chat` (covers both
  `POST /api/chat` and `POST /api/chat/reindex`) to `CHAT_SERVICE_URL`.
- **Rollback**: identical shape to §4.

## 6d. Resume Service (Batch 18) - no database, but a stateful side effect it doesn't fully own

Resume Service has no database of its own - there's no backfill, no dual-write, nothing in
§1.1/§1.3 to run. What makes it different from JD Parser Service (§6, also DB-less) is that its
permanent-file endpoints have a real side effect (a stored file, plus a pointer written on
`candidate_accounts`) that this service triggers but doesn't own the record of - see
`src/api/resume-internal.routes.ts`, which wraps the monolith's existing, unchanged
`db.updateCandidateProfile` (already dual-writing generically since Batch 16).

- **No shadow-validation built for this batch.** The two stateful endpoints
  (`POST`/`GET /candidate-resume/file`) mutate/read a real file on disk plus a real database
  pointer - shadowing them safely would require either mutating real state twice (unacceptable)
  or a read-only comparison that provides little signal beyond what
  `resume-service/tests/candidateResume.routes.test.ts` already covers with a real temp-disk
  round-trip. `POST /candidate-resume/parse` and `POST /parse-resume` are pure/stateless and could
  be shadow-compared later the same way `src/jdParserShadow.ts` does, if desired - not built yet,
  since neither is the highest-risk part of this extraction.
- **A real, disclosed limitation, not a regression**: permanent resume files live on this
  service's own local disk (`src/services/storage/StorageAdapter.ts`) - unchanged from what the
  monolith already does today, but it means this service cannot safely run more than one replica
  until a real object-storage backend exists. `helm/resume-service/values.yaml` sets
  `replicaCount: 1` and deliberately ships no HPA template to make that impossible to
  accidentally override.
- **Cutover**: `api-gateway/src/proxy.ts` already routes `/api/candidate-resume` and
  `/api/parse-resume` to `RESUME_SERVICE_URL`.
- **Rollback**: identical shape to §4 for the routing itself. Note the asymmetry this batch
  introduces: once real traffic is cut over, newly-uploaded resume files exist only on Resume
  Service's disk, not the monolith's `uploads/candidate-resumes/` - a rollback of the *routing*
  is instant and safe, but any files written *while* Resume Service was live would not be visible
  to the monolith after rolling back until a real shared/object storage backend exists. Do not
  cut this specific path over until that's resolved, or until you've accepted that specific
  trade-off explicitly.

## 6e. Recruiting Service (Batch 19) - a deliberately partial domain extraction

Unlike every prior batch, this one does NOT extract "the Recruiting domain" - it extracts the two
recruiter-facing route files that a domain audit confirmed have zero coupling to the not-yet-built
Matching Service: `recruiter-matches.routes.ts` and `recruiter-notifications.routes.ts`. Both
files' own header comments already stated they were built "brand-new, standalone... so
swipe.routes.ts/recruiter-review.routes.ts are never touched." The other four recruiter-facing
route files (`job.routes.ts`, `swipe.routes.ts`, `recruiter-review.routes.ts`,
`candidate-search.routes.ts`) all have deep, synchronous, hot-path coupling to Matching-domain code
(`rankCandidatesForJob`, `calculateMatchScore`, `computeMatchExplanation`, `generateRubricReport`)
and are explicitly deferred until Matching Service exists to proxy against - extracting them now
would mean either a forbidden big-bang (pulling in all of Matching too) or a hollow proxy-only
shell with no real ownership. This re-scoping was exercised under the "or equivalent if the audit
finds better bounded contexts" latitude, not asked as a question mid-batch.

- **Owns directly**: `recruiter_notifications` - real database (`tejoma_recruiting_service`, not
  `tejoma_recruiting`, which is already the monolith's own database name), real migration, real
  dual-write. All three FKs the monolith's copy has (`users`, `companies`, `mutual_matches`) are
  dropped in this service's own schema - none of those tables are owned here - same
  cross-service-FK-elimination precedent as `candidate_decisions`/`mutual_matches` (Batch 16) and
  `knowledge_base_chunks.company_id` (Batch 17).
- **Cannot own `GET /api/matches`**: `getRecruiterMatches()` joins
  `mutual_matches`+`jobs`+`candidates`+`recruiter_notifications` - only the last of those four
  tables is owned here. `GET /api/matches` proxies to a new monolith
  `/internal/recruiting/matches` endpoint (`src/api/recruiting-internal.routes.ts`), a thin wrapper
  around the unchanged `db.getRecruiterMatches()`.
- **Dual-write is two-directional in shape but one-directional in code**: `createMatchNotifications`
  (fired from `recordSwipe`'s mutual-match evaluation) now mirrors new `recruiter_notifications`
  rows via `dualWrite.upsertRecruiterNotification`; `markRecruiterNotificationRead`/
  `markAllRecruiterNotificationsRead` mirror `read_at` updates via
  `dualWrite.patchRecruiterNotification`. Both add a `RETURNING` clause to the primary write and
  propagate exactly what came back - never an independently recomputed timestamp, per dualWrite.ts's
  rule 4.
- **A real routing-collision fix, not a hypothetical one**: `recruiter-matches.routes.ts`'s only
  route is exactly `/api/matches`, but `swipe.routes.ts` (staying on the monolith, Matching domain)
  separately owns `/api/matches/queue/:job_id` and `/api/matches/score` - both of which start with
  `/api/matches/` and would be wrongly captured by the Gateway's normal prefix-matching. Fixed by
  adding an `exact: true` flag to `api-gateway/src/proxy.ts`'s `ROUTES` table, used only for this
  entry - every other route keeps the existing prefix-match behavior.
  `api-gateway/tests/proxy.routing.test.ts` asserts both excluded sub-paths still reach the
  monolith.
- **Cutover**: not yet - `api-gateway/src/proxy.ts` routes `/api/matches` (exact) and
  `/api/recruiter-notifications` to `RECRUITING_SERVICE_URL`, but API Gateway itself is not yet the
  production entry point (§7).
- **Rollback**: identical shape to §4. No shadow-validation was built for this batch (following
  §6b/§6c's pattern of building it only where the divergence risk is non-trivial) - both endpoints
  are simple CRUD/proxy with no generated or non-deterministic content, and
  `scripts/validate-recruiting-service-sync.ts` already provides the same "is the mirror correct"
  signal for the owned table.
- **What is still explicitly NOT extracted**: job posting/editing, swiping, recruiter review, and
  candidate search all remain on the monolith. Do not read "Recruiting Service exists" as "the
  Recruiting domain is extracted" - see this service's own `README.md` for the full reasoning.

## 6f. Identity Service, extended (Batch 21) - staff user management

A follow-on to Identity Service's original Phase 11/12 extraction, not a new service. Domain
audit: the monolith's `src/api/users.routes.ts` (admin CRUD on recruiters within their own
company - list/create/update/enable-disable/reset-password/soft-delete) reads and writes only
`users`, `password_history`, and `refresh_tokens` - all three already fully owned by Identity
Service, with dual-write into them already wired (`upsertUser`/`patchUser`,
`upsertPasswordHistory`/`prunePasswordHistory`, `upsertRefreshToken`/`revokeRefreshTokens`) since
an earlier batch. This is the cleanest extraction in the series so far: zero new dual-write code,
zero new migration (the existing schema already had every needed column), zero cross-service
proxy calls - the whole domain was already sitting on data this service already mirrors in real
time.

- **Owns directly**: nothing new - `identity-service/src/routes/users.routes.ts` and the 10 new
  `db.ts` functions it calls are additive reads/writes against tables already owned since Phase
  11/12. No dual-write needed FROM Identity Service's own routes here, for the same reason no
  other Tier 0 service's own routes dual-write anywhere: the monolith remains authoritative until
  cutover, and this service's own writes only ever touch its own database.
- **A real bug caught during validation**: the new `revokeAllRefreshTokensForUser` function
  duplicated one that already existed in `identity-service/src/db.ts` (added by an earlier,
  logout-related batch) - `tsc` caught the redeclaration immediately (`TS2323`/`TS2393`), and the
  duplicate (plus its duplicate entry in the `db` export object) was removed in favor of the
  original.
- **Auth model note, not a new limitation**: Identity Service verifies its OWN RS256/JWKS-signed
  tokens (`utils/tokens.ts`), not the monolith's HS256 tokens - this was already true of
  `auth.routes.ts` before this batch (staff auth has not cut over to Identity Service yet, per
  Identity Service's own README). `/api/users` inherits the exact same `requireAuth`/`requireRole`
  gate as every other route in this service - nothing new introduced here.
- **Cutover**: `api-gateway/src/proxy.ts` routes `/api/users` to `IDENTITY_SERVICE_URL`.
- **Rollback**: identical shape to §4.

## 6g. Analytics Service (Batch 22) - the first pure-proxy Tier 0 service

Domain audit of the monolith's three "*analytics*"-named route files found a clean split:
`analytics.routes.ts` (recruiter/admin dashboard, per-job stats, a recruiter's own profile stats,
skill distribution) is pure SQL aggregation over `swipes`/`jobs`/`candidates`/`users` - zero calls
into the live matching engine. `candidate-analytics.routes.ts` and `proficiency-analytics.routes.ts`
both call the live matching/shadow-scoring engine directly and stay on the monolith, deferred
until Matching Service exists - the same "defer the coupled slice" reasoning Recruiting Service
(Batch 19) already applied to job/swipe/review/search.

- **Owns nothing directly, by design** - unlike every prior service, Analytics Service has no
  database at all. The tables its routes read (`swipes`, `jobs`, `candidates`, `users`) are spread
  across domains this migration hasn't unified into one service, so there's no single table this
  service could sensibly own a copy of. Every route proxies to a new monolith
  `/internal/analytics/*` API (`src/api/analytics-internal.routes.ts`), a thin wrapper around the
  unchanged `db.ts` aggregation functions - the "proxy what you don't own" pattern taken to its
  logical extreme (proxying *everything*, since there's nothing to own).
- **Response shape preserved exactly**, including the deliberate snake_case/camelCase duplication
  on `/dashboard` that `Dashboard.tsx`/`SwipeInterface.tsx` already depend on - the internal route
  builds the identical object the monolith's own `analytics.routes.ts` always returned.
- **A real routing-scope decision, not a hypothetical one**: `/api/analytics` is registered as a
  narrow prefix, deliberately not broad enough to also catch `/api/candidate-analytics`,
  `/api/proficiency-analytics`, or `/api/shadow-data-health` - all three are separate path
  prefixes that were never added to the Gateway's `ROUTES` table, so they fall through to the
  monolith by the same exact-segment matching every other narrow route in that table already
  relies on. `api-gateway/tests/proxy.routing.test.ts` asserts all three stay on the monolith.
- **Cutover**: `api-gateway/src/proxy.ts` routes `/api/analytics` to `ANALYTICS_SERVICE_URL`.
- **Rollback**: identical shape to §4 - trivially so here, since there's no database to worry
  about un-syncing.

## 6h. Matching Service extraction prep (Batch 23) - no new service, monolith-internal refactor only

Before Batch 22, a domain audit of `src/matching/` (~40 files, plus `src/services.ts` sitting
physically outside the directory but functionally part of it) concluded that **no sub-slice of
the matching engine could be safely extracted** - every grouping that looked self-contained
(careerIntelligence, reasoning, the offline-ML trio) turned out to be reached from at least one
hot-path file, and `src/services.ts` was bidirectionally coupled with `src/matching/` while also
being imported directly by two route files, bypassing the "unified" `matchingApi.ts` entry point
entirely. Three concrete blockers were identified; this batch fixes all three. It creates no new
Tier 0 service, touches no dual-write/gateway/infra - it's pure internal refactoring so a future
Matching Service extraction batch (or small number of them) has something safe to act on.

- **Blocker 1 fixed - in-memory model-selection state moved to the database.** `activeModelType`
  (which gates the ML-ensemble blend on every scored batch) was a plain `export let` in
  `src/services.ts`, reset to `'random_forest'` on every process restart and unreadable by any
  process other than the one that set it - the same category of problem already confirmed to rule
  out `ml.routes.ts` as a standalone extraction candidate. New table `matching_model_config`
  (migration-matching-model-config.sql; also added to schema.sql) persists it. The exported
  `activeModelType` binding itself is UNCHANGED - every hot-path read in `services.ts`/
  `matchingApi.ts` still reads the same in-memory variable directly, zero added latency; only
  module load (loads the persisted value once, fire-and-forget) and `setActiveModelType` (now
  async, persists via `db.setMatchingModelConfig` before resolving) changed.
  `POST /api/ml/config` (`ml.routes.ts`) now awaits the persisted write and surfaces a 500 if it
  fails, instead of silently mutating memory only. Verified with a real HTTP call against the real
  database (not simulated) - confirmed the row change with a direct `SELECT` before and after.
- **Blocker 2 fixed - the two entry-point bypasses removed.** `swipe.routes.ts` and
  `recruiter-review.routes.ts` both imported `calculateMatchScore` from `services.ts` directly,
  skipping `matchingApi.ts` (the module every other live surface already goes through). New
  `matchingApi.ts` export `scoreCandidateForJob()` wraps `rankCandidatesForJob` for the
  single-candidate case; both route files now call it instead. Verified with a direct equivalence
  check against real job/candidate rows: `calculateMatchScore(job, candidate, opts)` (old path,
  still exported) and `scoreCandidateForJob(job, candidate, opts)` (new path) produce
  byte-identical JSON output.
- **Blocker 3 fixed - `src/services.ts` moved into `src/matching/services.ts`.** This was a
  package-level cycle, not a single-file one: `services.ts` imported from 6 individual files
  inside `src/matching/`, while 4 different files inside `src/matching/` imported scoring
  functions (and the `activeModelType` binding) back from `services.ts`. Relocating the file makes
  the directory boundary honest - `src/matching/` now really does contain everything the matching
  engine needs, with a clean outer boundary (only `db.ts`, `types.ts`, `utils/*`, `algorithms/*`
  are imported from outside it). Zero logic changed - every function body, formula, and comment is
  unchanged; only import paths were updated (12 files' imports, plus a benchmark script and 8
  scattered comment references that would otherwise have pointed at a file that no longer exists
  at that path).
- **Validation**: `tsc --noEmit` clean (only the pre-existing, unrelated `read-xml.js` error every
  batch since Batch 19 has confirmed via `git stash`). Full monolith suite: 49 files, 556 tests,
  all passing - including `tests/matching/*` (which call `setActiveModelType` directly, so this
  also exercises the new DB-write path hundreds of times over). Real DB write confirmed via direct
  `SELECT` after a live HTTP call. Real function-level equivalence confirmed for the rerouted
  swipe/recruiter-review call sites (no existing test file covers either route directly - the
  equivalence check was written specifically because the passing test suite alone didn't prove
  this one).
- **What this unblocks, not yet done**: a real Matching Service extraction batch (or small number
  of sequenced batches) can now be planned without hitting the three blockers above. This batch
  does not itself extract anything - `src/matching/` (43 files now, including `services.ts`) is
  still 100% monolith-internal.

## 6i. Matching Evaluation Service (Batch 24) - the first extracted slice of Matching

Re-auditing `src/matching/` after Batch 23 (rather than assuming the pre-Batch-23 audit's
groupings still applied) found two genuinely separable files: `evaluation.ts` (zero
`src/matching/` internal imports at all - pure computation + two `db.ts` calls) and
`learningToRank.ts` (exactly one internal dependency, the live scoring engine's
`calculateMatchScoresBatch`, which becomes a clean proxy dependency). Everything else nominated in
the original audit as a "shadow/offline" candidate - `shadowDataHealth.ts`,
`proficiencyAnalytics.ts`, `bgeShadowRetrieval.ts` - turned out to revolve around tables the
monolith's `shadowScoring.ts` writes to **on every swipe** (a live, frequently-firing background
path, not an offline concern), which would require the monolith to proxy a WRITE out to a new
service instead of the usual read-proxy direction - real work, deliberately deferred to its own
batch rather than doubling this one's scope.

- **Owns directly**: `match_evaluation_runs` and `ltr_model_versions` - both have a simple,
  single-writer relationship to the two ported source files, real dual-write already wired into
  the monolith's own (unchanged) `saveEvaluationRun`/`saveLtrModelVersion`.
- **Proxies to the monolith** (new `/internal/matching-evaluation/*` API): swipe/candidate/job
  data (`swipes`/`candidates`/`jobs` remain monolith-owned) and the live scoring engine's
  feature-vector computation (`calculateMatchScoresBatch`, needed only by LTR training).
- **Calls the Python Learning-to-Rank service directly** (its own copy of `algorithms/
  ltr-models.ts`) - never through the monolith, exactly as the monolith's own copy always did.
- **The monolith's `ml.routes.ts`/`evaluation.ts`/`learningToRank.ts` are completely unchanged**
  and continue serving real traffic - same strangler-fig shape as every batch since JD Parser
  Service. Only Batch 23 was a true "move"; every actual service extraction (including this one)
  copies, never deletes, the monolith's original.
- **A real routing-scope decision**: `/api/ml/evaluate`, `/api/ml/train/ranking`, and
  `/api/ml/ranking/status` are three narrow prefixes, not a blanket `/api/ml` claim - `/api/ml/
  config`, `/api/ml/train` (the production ensemble, a different path, not a sub-path of `/api/ml/
  train/ranking`), `/api/ml/model/status`, and `/api/ml/model/versions` all stay on the monolith.
  `api-gateway/tests/proxy.routing.test.ts` asserts all four stay on the monolith.
- **A real bug caught during validation, not a hypothetical one**: the mock monolith's response
  keys in this service's own test file were set to bare leaf paths (e.g. `/swipes-for-evaluation`)
  instead of the full path the real `monolithClient.ts` actually requests
  (`/internal/matching-evaluation/swipes-for-evaluation`) - a `.startsWith()` prefix check that
  silently never matched, so every proxy call fell through to the mock's default empty response,
  and `evaluateFromSwipes` crashed on `swipes is not iterable` (an array destructured from `{}`).
  Caught by actually running the tests, not by review - fixed by matching the exact convention
  chat-service's own test file (Batch 17) already established for multi-endpoint mocks.
- **A real, deliberate test design decision**: the Python Learning-to-Rank service genuinely runs
  via docker-compose in this local dev environment (confirmed live - `curl localhost:8009/health`
  returned a real, already-trained ranker) - unlike CI, where it's never running. Rather than let
  this service's tests hit a real, shared model with throwaway fake training data (an actual side
  effect on shared state, however minor), `MATCHING_ML_SERVICE_URL` is deliberately pointed at an
  unreachable address for the whole test file, exercising the real graceful-degradation code path
  deterministically instead of depending on what happens to be running locally.
- **Validation**: `tsc --noEmit` clean (only the same pre-existing `read-xml.js` error). This
  service: 10/10 tests. Monolith: 561/561 (556 + 5 new), including a new internal-route test that
  calls the real, unchanged `calculateMatchScoresBatch` through the new proxy endpoint end-to-end.
  API Gateway: 53/53. Real Docker build + run + curl against the real host database (`/health`
  200, a real 401 on an unauthenticated route). `helm lint`/`template` clean on both charts
  (the local `helm` binary was blocked mid-session by a Windows Application Control policy change
  unrelated to this work - validated via a containerized `helm` instead, same real tool, different
  invocation path). `terraform validate` and `actionlint` clean.
- **What's still explicitly NOT extracted**: skill/role intelligence, career intelligence,
  reasoning, the live scoring engine itself, `shadowDataHealth.ts`/`proficiencyAnalytics.ts`/
  `bgeShadowRetrieval.ts`, and job/swipe/review/search all remain on the monolith. See this
  service's own `README.md` for the full reasoning.

## 6j. Matching Evaluation Service, extended (Batch 25) - shadow-analytics reporting

Continues directly from 6i's "deferred" list. Re-reading `src/matching/shadowScoring.ts` in full
(not trusting 6i's own README claim) found that 6i's assumption was wrong: `shadowScoring.ts`'s
only write, `db.insertProficiencyShadowScore`, is a single INSERT fired from
`swipe.routes.ts`/`recruiter-review.routes.ts` via `logShadowScoresInBackground` - a normal
forward dual-write hook (the same pattern as every other batch) is sufficient, no reverse proxy
needed. This simplified the real scope considerably: `shadowDataHealth.ts` and
`proficiencyAnalytics.ts` (both pure, read-only reporting functions over that one table) are now
extracted; `bgeShadowRetrieval.ts` stays deferred (confirmed via `grep` to have zero reporting-route
consumers - only `db.ts`/`types.ts`/its own writer reference `bge_retrieval_shadow_comparisons`).

- **Owns directly (new)**: `proficiency_shadow_scores` - unlike this service's first two tables
  (Batch 24, written by its own ported logic), this one is **read-only** from the service's own
  code. It's populated entirely by dual-write from the monolith's completely UNCHANGED
  `shadowScoring.ts`; there is no insert/save function for it in this service's `db.ts`, only a
  read (`getAllProficiencyShadowScoresForCompany`).
- **Ported**: `shadowDataHealth.ts` and `proficiencyAnalytics.ts`, byte-identical to the monolith's
  originals except for where data comes from - `db.getAllProficiencyShadowScoresForCompany` reads
  this service's own dual-written mirror (a local DB read, unchanged in shape); `db.getJobById`
  (a monolith DB read, per job) became `monolithClient.getJobTitles` (a proxied, batched call -
  jobs remain monolith-owned).
- **A small, deliberate duplication**: `shadowDataHealth.ts` needs `inferSeniority` from the
  monolith's `careerIntelligence/jobSequence.ts`, but that file's top-level imports also pull in
  `dynamicWeighting.ts` (used by other functions in the same file, not by `inferSeniority` itself) -
  the exact transitive-coupling trap the original pre-Batch-23 audit flagged elsewhere. Resolved by
  duplicating the ~15-line pure function into this service's own `matching/seniorityInference.ts`,
  the same "small utility, own copy per service" convention already used for
  `requestId.middleware.ts`/`logger.ts`/`algorithms/ltr-models.ts` (Batch 24).
- **New monolith `/internal/matching-evaluation/job-titles`**: added to the existing
  `matching-evaluation-internal.routes.ts` (Batch 24) rather than a new router file - batches
  `db.getJobById` lookups across the job ids a company's shadow-score rows reference, company-
  scoped, silently dropping any id that doesn't belong to the caller's company (never leaks another
  tenant's job title).
- **Gateway routing**: two new narrow prefixes, `/api/proficiency-analytics` and
  `/api/shadow-data-health`, cut over immediately to this service (both were previously explicitly
  named in the Batch 22 Analytics Service comment as future distinct prefixes that must never be
  swallowed by `/api/analytics` - anticipated, not accidental). `/api/candidate-analytics` is
  unaffected and still stays on the monolith.
- **Two real bugs caught by actually running the migration, not by review**:
  1. The migration's own `INSERT INTO schema_migrations (version) VALUES ('002_proficiency_shadow')`
     exceeded the `version VARCHAR(20)` column (22 characters) - `migrate.ts up` failed immediately
     with `value too long for type character varying(20)`. Separately, and worse: `migrate.ts`'s
     `discoverMigrations()` derives the tracked "version" from the **filename**
     (`002_proficiency_shadow_scores`, stripped of `.up.sql`), not from the string the SQL file
     itself inserts - so even a shortened in-SQL string would have permanently mismatched the
     filename-derived tracking key, making the migration appear perpetually "pending" on every
     future `migrate.ts up` run. Fixed by renaming both migration files to
     `002_shadow_scores.up.sql`/`.down.sql` (17 characters) so the filename-derived version and the
     SQL's own hardcoded `INSERT`/`DELETE` value are identical, matching how `001_initial_schema`
     (Batch 24) already got this right.
  2. `scripts/lib/migrationDb.ts`'s generic `backfillTable()` passed JSONB column values straight
     through as query parameters. `skill_multipliers`/`recency_skill_multipliers`/
     `reasoning_covered_domains`/`reasoning_uncovered_domains` are JSONB columns holding JS arrays -
     node-pg serializes a bare JS array parameter as a Postgres array literal (`{...}`), not JSON
     text, which would have failed (or worse, silently miswritten) against a `jsonb` column. No
     prior batch's backfill ever exercised a JSONB-array column, so this was latent, not previously
     hit. Fixed by adding an optional `jsonColumns` list to `BackfillTableSpec` -
     `backfill-matching-evaluation-service.ts` now explicitly `JSON.stringify`s those four columns
     before sending them as params, mirroring the same fix already applied directly inside
     `dualWrite.ts`'s new `upsertProficiencyShadowScore`. Verified for real: ran the backfill
     non-dry-run against a real seeded row and read it back with `psql`-equivalent queries against
     both databases - both matched, including nested JSON structure.
- **Real, end-to-end dual-write verification**: with `DUAL_WRITE_ENABLED=true`, called the real
  (unchanged) `db.insertProficiencyShadowScore` against the real monolith database and confirmed
  the row landed in `matching-evaluation-service`'s real database with the exact same `id` (from
  the primary write's own new `RETURNING id, computed_at` clause) and correctly-parsed JSONB array
  columns - not a fabricated or unit-level check. Test data removed from both databases afterward.
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the API Gateway (only the
  same pre-existing `read-xml.js` error on the monolith). This service: 15/15 tests (10 from Batch
  24 + 5 new). Monolith: 564/564 (561 + 3 new job-titles endpoint tests). API Gateway: 53/53
  (updated the Batch 22 collision test - `/api/proficiency-analytics`/`/api/shadow-data-health` no
  longer fall through to the monolith, now correctly asserted as routed to this service instead;
  `/api/candidate-analytics` still does). Real Docker build + run + curl against the real host
  database confirmed both new endpoints return real computed data (`/health` 200, both new routes
  200 with real shapes for a company with zero shadow-score rows).
- **What's still explicitly NOT extracted**: `bgeShadowRetrieval.ts` (zero reporting consumers,
  genuinely deferred, not forgotten), skill/role intelligence, career intelligence, reasoning, the
  live scoring engine itself, and job/swipe/review/search all remain on the monolith.

## 6k. Matching Reasoning Service (Batch 26) - a new cutover shape: monolith as client

A fresh dependency-graph audit of the ~39 remaining `src/matching/` files (an Explore agent traced
every internal import both directions, since the file count made a manual read impractical) found
that almost everything left is tangled into the live per-request scoring path via two hub files -
`dynamicWeighting.ts` and `services.ts`/`matchingApi.ts`. Two clusters fell genuinely outside that
tangle: the AI Reasoning Layer (6 files: `computeReasoning.ts` + 5 reasoning modules) and Unknown
Skill Discovery. The Reasoning Layer won: its own header comment already states "does NOT wire any
of it into live Dynamic Weighting... or the Explainability layer," it has an exclusive table
(`reasoning_conclusions`), and only 2 route files ever call into it, both fire-and-forget.

- **A genuinely new problem, confirmed with the user before implementation**: unlike every batch
  since JD Parser Service, this slice has no separately-routable HTTP endpoint of its own to hand
  to API Gateway - `computeReasoningForCandidateInBackground`/`ForJobInBackground` are fire-and-
  forget side effects of `POST /api/candidates`/`POST /api/jobs`, which stay on the monolith. The
  chosen shape: the monolith becomes an HTTP *client* of the new service - the same relationship it
  already has with `python-services/matching-ml-service`, just for a Tier 0 TypeScript service.
  Implemented as a shadow-validation module (`src/reasoningServiceShadow.ts`), the same disabled-
  by-default, never-affects-real-behavior discipline as `jdParserShadow.ts`/`candidateShadow.ts` -
  not a hard behavioral swap, since §4's real traffic-shifting step has never been executed for any
  service in this repository (§7).
- **Owns and writes directly**: `reasoning_conclusions`, computed by this service's own ported
  logic when the monolith's shadow caller invokes `POST /internal/compute-for-candidate`/
  `/compute-for-job`.
- **Owns a dual-written, read-only-from-its-own-code mirror**: `skill_nodes`/`skill_edges`. The
  monolith remains the sole writer (`skillIntelligence.ts`'s seeding, `unknownSkillDiscovery.ts`'s
  promotion pipeline) - `dualWrite.ts` gained `upsertSkillNode`/`upsertSkillEdge`/`patchSkillNode`
  targeting this service's database. Both tables mirror together into the SAME target database, so
  - unlike every other dual-write target in this migration - `skill_edges` keeps its real FK to
  `skill_nodes(id)` on the target side too (not a cross-service FK, since both tables live in the
  same new database).
- **No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`**: this service has no user-facing HTTP
  surface at all - its only caller is the monolith itself, trusted by network boundary (the
  inverse direction of every other `/internal/*` endpoint in this migration). Confirmed api-gateway
  needs zero changes: its health-aggregation list already excludes `tenant-directory-service` (also
  never gateway-routed), establishing that only actual `ROUTES` upstreams are tracked there.
- **Ported byte-identical**: all six reasoning modules. **Ported, narrowed**:
  `projectIntelligence.ts`'s `analyzeProject`/`analyzeProjectEntries` (read-only slice
  `causalReasoning.ts` needs, not its write-side `computeAndStoreProjectIntelligence`). **Small,
  deliberate duplicates**: `skillLookup.ts` (`canonicalizeSkill`/`canonicalizeSkills`, 2-line
  wrappers), `utils/vectorMath.ts` (`cosineSimilarity`, pure function), `algorithms/
  bert-embeddings.ts` (`generateEmbedding`, calls the shared Python ML service directly, same
  client shape as `matching-evaluation-service`'s copy).
- **Two real bugs caught by actually running things, not by review**:
  1. Same VARCHAR(20)/filename-mismatch trap as Batch 25 - caught immediately this time from that
     experience, so the migration was named `001_initial_schema` (matching Batch 24's own correct
     precedent) from the start, never hit in this batch.
  2. None found this batch beyond confirming the lesson above held - `skill_nodes.embedding`/
     `aliases` are native Postgres array columns (`DOUBLE PRECISION[]`/`TEXT[]`), not JSONB, so
     passing a bare JS array as a dual-write parameter is *correct* here (node-pg's array-literal
     serialization is exactly what a native array column needs) - the opposite of Batch 25's JSONB
     finding, verified explicitly rather than assumed.
- **Real, end-to-end verification of the new cutover shape**: seeded a real skill graph (a "Web
  Development" domain PARENT_OF React/Vue.js/Angular, cross-RELATED_TO) via the monolith's own
  unchanged `db.upsertSkillNode`/`upsertSkillEdge` with `DUAL_WRITE_ENABLED=true`, confirmed it
  landed in the real running `matching-reasoning-service`, then called the real (unchanged)
  `computeReasoningForCandidateInBackground` with `SHADOW_REASONING_ENABLED=true` pointed at that
  real running instance. Result: the monolith computed 5 real conclusions locally: **and** the
  shadow HTTP call reported real agreement (`Shadow-validation agreement: matching-reasoning-service
  matched the monolith for this subject`) - independent computation from independently-mirrored
  data, not a fabricated or unit-level check. All test data removed from both databases afterward.
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the API Gateway (only the
  same pre-existing `read-xml.js` error). This service: 8/8 tests. Monolith: 564/564 (no change in
  count - this batch only swapped an import, added dual-write hooks, and added a new unused-by-
  tests shadow module). API Gateway: 53/53 (unchanged, no gateway modifications this batch). Real
  Docker build + run + curl (`/health` 200, `POST /internal/compute-for-candidate` 200 with a real
  empty-conclusions response for an unseeded candidate, `GET` on the same path correctly 404s).
  `helm lint`/`template` clean (containerized fallback, same as Batch 24/25). `terraform validate`
  and `actionlint` clean (both via Docker, no local binaries available this session either).
- **What's still explicitly NOT extracted**: everything else in `src/matching/` - skill/role
  intelligence, career intelligence, dynamic weighting, the live scoring engine, and Unknown Skill
  Discovery (the next-best candidate per this batch's own audit, deferred to its own batch) all
  remain on the monolith.

## 6l. Matching Skill Discovery Service (Batch 27) - bidirectional traffic, for the first time

Continues directly from Batch 26's own audit, which ranked Unknown Skill Discovery as the #2
candidate (nearly as clean as the Reasoning Layer): exclusive table (`skill_discovery_proposals`),
only reachable from 2 route files (`candidate.routes.ts`/`job.routes.ts`, both fire-and-forget),
plus its own dedicated admin route file (`skill-intelligence.routes.ts`) already isolated from the
live scoring hot path.

- **Same "no separate trigger endpoint" problem as Batch 26, solved the same way**: the automatic
  discovery pipeline is a background side effect of candidate/job creation - `src/
  skillDiscoveryServiceShadow.ts` is a drop-in replacement for `discoverUnknownSkillsInBackground`
  (swapped into `candidate.routes.ts`/`job.routes.ts`), gated behind
  `SHADOW_SKILL_DISCOVERY_ENABLED` (default off), following `reasoningServiceShadow.ts`'s exact
  contract.
- **A genuine architectural first for this migration: traffic now flows in BOTH directions between
  the monolith and one new service.** `unknownSkillDiscovery.ts`'s promotion step
  (`promoteToSkillNode`) needs to create a real `skill_nodes`/`skill_edges` row - a write this
  service must never perform itself, since Batch 26 already established the monolith as sole
  writer of the skill graph. Rather than duplicate that authority, this service proxies the write
  OUT to a new monolith `/internal/skill-discovery/promote` endpoint (the normal "proxy what you
  don't own" direction, same as every batch before Batch 26) - while ALSO being called INTO by the
  monolith's shadow module for the trigger (Batch 26's inverted direction). Both directions are
  real and independently tested.
- **A real correctness issue resolved before it could become a bug, not found by inspection after
  the fact**: classification is a non-deterministic LLM call. Left unguarded, the shadow-triggered
  background pipeline could have independently decided to auto-promote when the monolith's real,
  authoritative run did not (or vice versa) - causing a real, uncoordinated write to the shared
  skill graph from what must be a comparison-only path, breaking the hard "shadow calls never
  affect real behavior" rule every shadow module in this migration follows. Fixed with a
  `skipPromotion` parameter (additive only, not in the monolith's original signature) threaded
  through `discoverUnknownSkill`/`discoverUnknownSkills`: the shadow entry point
  (`POST /internal/discover`) always passes `skipPromotion: true` - the proposal is still fully
  computed and stored in this service's own table, but the actual external promotion call is
  skipped. Verified directly: a seeded proposal engineered to cross the auto-promote threshold on a
  second sighting reaches `status: 'auto_promoted'` in this service's own table while
  `promoted_skill_node_id` stays `null` and the mock monolith records zero calls.
- **One additive, zero-behavior-change edit to the monolith's own unchanged file**: the monolith's
  `discoverUnknownSkills` (the per-request loop) previously returned `Promise<void>`, discarding
  every per-token outcome - every real call site already ignored the return value
  (`discoverUnknownSkillsInBackground`'s `.catch()`-only chaining). Widened to
  `Promise<DiscoveryOutcome[]>` so the shadow module can report a real outcome count without a
  second, duplicate call into the pipeline (which would have double-counted `mention_count` on any
  token the real call already touched - a real data-integrity risk, not just redundant work).
  Every line of internal logic is unchanged.
- **Owns and writes directly**: `skill_discovery_proposals`, computed by this service's own ported
  7-stage pipeline (detection, LLM classification, embedding-based semantic search, relationship
  proposal, confidence scoring, promotion-trigger, human verification). Own copies of the Gemini
  classification client and the BERT embedding client, same pattern as every prior batch's own
  copies - `GEMINI_API_KEY` deliberately kept optional (graceful degradation to manual review,
  preserving the monolith's own original behavior exactly, never made required).
- **Owns a dual-written mirror, read-only from this service's own code**: `skill_nodes` only (not
  `skill_edges` - this service never reads it). `skill_nodes` now mirrors to TWO independent
  target databases (Matching Reasoning Service's from Batch 26, and this service's own) - each
  service owns its own isolated copy, no cross-service database sharing. `dualWrite.ts`'s
  `upsertSkillNode`/`patchSkillNode` now fan out to both pools internally; no `db.ts` call sites
  needed to change.
- **Not gateway-routed, unlike Reasoning's precedent** - see this service's own README.md for why:
  unlike `reasoning_conclusions`, `skill_discovery_proposals` has no way to be backfilled/mirrored
  from a monolith primary write (there is no deterministic primary write to mirror - classification
  is itself the computation). Routing the real admin UI here today, before this service has ever
  computed proposals against real traffic, would show an empty or wrong pending-list - a real
  regression. `/api/skills/discovery/pending|:id/approve|:id/reject` are fully built, tested, and
  ready, exactly at the same "built and validated, not yet cut over" point every other service in
  this migration started at.
- **Real, end-to-end verification of both new traffic directions**: seeded a real skill node via
  the monolith's own unchanged `db.upsertSkillNode` with `DUAL_WRITE_ENABLED=true`, confirmed it
  fanned out to BOTH `matching-reasoning-service`'s and `matching-skill-discovery-service`'s real
  databases. Called the real `discoverUnknownSkillsInBackground` (via `skillDiscoveryServiceShadow.ts`)
  with `SHADOW_SKILL_DISCOVERY_ENABLED=true` against the real running service and a real,
  live Gemini call (not mocked) for a nonsense token - both the monolith and the new service
  independently classified it as `not_a_skill`, and the shadow comparison logged real agreement
  (`matching-skill-discovery-service processed the same number of unresolved tokens as the
  monolith`). Separately confirmed the reverse direction via Docker: `POST /internal/skill-discovery/
  promote` against the real running monolith created a real `skill_nodes` row with the correct
  `technology_domain` derived from `domainFor`, plus the correct bidirectional `RELATED_TO` edge
  pair when a related skill id was supplied. All test data removed from all three databases
  afterward.
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the API Gateway (only the
  same pre-existing `read-xml.js` error). This service: 13/13 tests. Monolith: 567/567 (564 + 3
  new promote-endpoint tests). API Gateway: 53/53 (unchanged, no gateway modifications this batch -
  see the "not gateway-routed" point above). Real Docker build + run + curl (`/health` 200, a real
  401 on the unauthenticated admin route, `POST /internal/discover` 200). `helm lint`/`template`
  clean (containerized fallback, same as every batch since Batch 24). `terraform validate` and
  `actionlint` clean.
- **What's still explicitly NOT extracted**: skill/role intelligence, career intelligence, dynamic
  weighting, the live scoring engine (`services.ts`/`matchingApi.ts`), and job/swipe/review/search
  all remain on the monolith - by far the largest remaining slice of this domain, and of the whole
  system. No production traffic cutover was performed for this or any prior batch - see §7.

## 6m. Matching BGE Shadow Service (Batch 28) - the first genuine, real cutover

Closes out the shadow-analytics trio Batch 24 originally deferred (`shadowDataHealth.ts`/
`proficiencyAnalytics.ts` moved in Batch 25; `bgeShadowRetrieval.ts` deferred again in Batch 26's
own audit "confirmed via grep to have zero reporting-route consumers"). Re-confirmed that finding
still held before building anything.

- **The first batch in this migration where the new service's trigger was actually cut over for
  real, not shadow-validated.** Every batch since Batch 15 either routed a real user-facing
  endpoint through the Gateway (with backfilled, dual-written data first) or built a shadow-
  validation comparison alongside an unchanged, still-authoritative monolith computation (Batches
  26/27). This module qualifies for neither pattern in the usual sense - its own header comment
  already stated "SHADOW MODE ONLY - never affects which candidates a recruiter sees or their
  order" and it has zero reporting consumers (re-confirmed via `grep`, unchanged since Batch 26's
  finding). There was no real, authoritative behavior to preserve-and-compare against - the
  monolith's own computation was already a non-authoritative side channel. `swipe.routes.ts`'s
  single call site (`logBgeShadowComparisonInBackground`) now calls this service directly
  (`src/bgeShadowServiceClient.ts`) instead of the local module - a genuine, permanent behavior
  change in *where* the computation runs, but a byte-identical one in *what* it does and *who* can
  observe it (nobody, before or after).
- **Owns and writes directly, no dual-write, no backfill**: `bge_retrieval_shadow_comparisons`.
  Historical rows logged by the monolith before this batch's cutover simply stay in the monolith's
  own (still-existing, still-unread) table - nothing depends on continuity between the two tables,
  since nothing ever read this data for reporting.
- **The monolith's own `bgeShadowRetrieval.ts`/`bgeRetrievalClient.ts` remain completely intact and
  untouched** - strangler-fig discipline maintained even here, where the practical risk of deleting
  them would have been genuinely low. Simply unreferenced now (confirmed via `grep`: only
  `swipe.routes.ts`'s new import path calls into the replacement client).
- **Ported byte-identical**: `computeBgeShadowComparison` and its pure helpers
  (`computeTopKOverlap`, `computeRankCorrelation`), and the BGE-M3/BGE-Reranker-v2-m3 HTTP client
  (own copy, calls `python-services/bge-retrieval-service` directly, same "return null, never
  throw" contract). `Candidate`/`Job` narrowed to only the fields `candidateText()`/`jobText()`
  actually read (`BgeCandidateInput`/`BgeJobInput`) - the monolith's caller still serializes the
  full objects over HTTP; extra fields are simply ignored on receipt, exactly as they always were
  ignored by the original functions' own destructuring.
- **No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`** - this service needs nothing back
  from the monolith at all: `swipe.routes.ts` already has the full `Job` and ranked `Candidate`
  list in memory at the call site and passes them directly in the request body.
- **No `SHADOW_*_ENABLED` flag, unlike every other client in this migration** - there is nothing to
  gate. If `MATCHING_BGE_SHADOW_SERVICE_URL` is unset, the client silently no-ops, exactly
  reproducing the pre-batch default state ("nothing starts the BGE Python service automatically" -
  the monolith's own original had the identical no-op-when-unreachable behavior).
- **Real, end-to-end verification**: started the real service, called the real (unchanged)
  `logBgeShadowComparisonInBackground` client with `MATCHING_BGE_SHADOW_SERVICE_URL` pointed at it,
  and confirmed a real row landed in the service's real database with the correct
  `bge_available: false` (the Python BGE service isn't running in this environment - correct
  graceful degradation, not a fabricated success). Confirmed via Docker separately: `POST
  /internal/compare` against the real running container returns `{"stored":true,"bgeAvailable":
  false,"poolSize":0}` for an empty pool. All test data removed afterward.
- **Validation**: `tsc --noEmit` clean on the monolith and this service (only the same pre-existing
  `read-xml.js` error). This service: 6/6 tests. Monolith: 567/567 (unchanged count - this batch
  only swapped one import; no committed unit test exists for any of this migration's thin
  monolith-side shadow-client wrapper modules, following the established precedent from Batches
  26/27, validated instead via real smoke-test scripts). `helm lint`/`template` clean (containerized
  fallback, same as every batch since Batch 24). `terraform validate` and `actionlint` clean.
- **What's still explicitly NOT extracted**: skill/role intelligence, career intelligence, dynamic
  weighting, the live scoring engine, and job/swipe/review/search all remain on the monolith - this
  batch closes out the shadow-analytics/offline-diagnostics corner of the Matching domain
  entirely, but the live, hot-path core is untouched.

## 6n. Role Intelligence Service (Batch 29) - a real "genuinely zero consumers" check that came back different

Opens the live-scoring-engine decomposition proper, following a fresh Explore-agent dependency
audit of everything remaining in `src/matching/` (39 files) plus the 5 hot-path route files. That
audit's most important finding: `dynamicWeighting.ts`'s scoring functions, `explainability.ts`
(singular), and `retrieval.ts` are all imported by `services.ts`/`matchingApi.ts` at module scope
but **never executed on any live request today** - confirmed via `grep -rln "'dynamic'"` and
`grep -rn "retrieval: {"` across `src` and `scripts`, both returning zero call sites, and the
code's own comment at `services.ts:400-401` already says so ("Not called by any existing surface
by default"). That reclassifies the "hub" from one inseparable unit into a small, genuinely
load-bearing live-scoring core plus several dormant/background lanes safe to extract now, before
anyone activates them.

`roleIntelligence.ts` was the cleanest candidate this audit surfaced: its own wrapper functions
(`getRoleProfile`, `getAllRoleProfiles`, `matchRoleByTitle`) have exactly one caller anywhere in
the repository - `scripts/seed-intelligence-layer.ts`, and even that only calls the write side
(`seedRoleProfiles`). No route file, live or background, calls this file's own read functions.

- **A real nuance that changed the shape of this batch from Batch 28's precedent**: initial
  instinct (matching Batch 28's "zero consumers, full ownership transfer" shape) was wrong.
  `role_profiles` **itself** (the table, not this file's wrapper functions) has real, live
  consumers still on the monolith: `dynamicWeighting.ts`, `careerWeighting.ts`,
  `proficiencyWeighting.ts`, `recencyWeighting.ts`, and `careerIntelligence/
  futureRolePrediction.ts` all call `db.getAllRoleProfiles()` **directly**, bypassing
  `roleIntelligence.ts` entirely. `careerWeighting.ts`/`proficiencyWeighting.ts`/
  `recencyWeighting.ts` in particular are part of the real (if fire-and-forget) shadow-scoring
  pipeline that fires on every swipe/recruiter-review decision today - not dormant like
  `dynamicWeighting.ts`'s own scoring path. So `role_profiles` needed the Batch 26/27 dual-write
  shape (mirror, monolith stays authoritative), not the Batch 28 shape (full cutover) - "zero
  consumers" has to be checked per-table, not assumed from a similarly-shaped extraction one batch
  earlier.
- **Owns a dual-written, read-only-from-this-service's-own-code mirror**: `role_profiles`. No FK
  on this table in the monolith's own `schema.sql` - nothing to drop on the target side.
- **Ported, read-only**: `getRoleProfile`, `getAllRoleProfiles`, `matchRoleByTitle` - byte-identical
  logic. The write side (`ROLE_SEEDS`, `seedRoleProfiles`) stays on the monolith, unchanged, still
  the sole writer.
- **No trigger to swap at all** - a genuine first for this migration. Every prior batch either
  routed a real endpoint through the Gateway, built a shadow-validation client alongside a real
  trigger (Batches 26/27), or cut over a fire-and-forget call site (Batch 28). This file's read
  functions have no caller anywhere to swap - the new service's `/internal/*` endpoints exist,
  are fully tested, and are ready for whichever future caller needs them, with nothing to change
  in any route file this batch.
- **No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`** - no route in the monolith exposes
  role-profile data over HTTP today (confirmed via `grep` across every `src/api/*.routes.ts`), so
  there's no user-facing surface to match and nothing to proxy back to the monolith for.
- **Real, end-to-end dual-write verification**: called the real (unchanged) monolith
  `db.upsertRoleProfile` and `db.updateRoleProfileEmbedding` with `DUAL_WRITE_ENABLED=true`,
  confirmed both fanned out correctly to the real Role Intelligence Service database with the
  exact same `id` and the exact embedding value written. Test data removed from both databases
  afterward.
- **Validation**: `tsc --noEmit` clean on the monolith and this service (only the same
  pre-existing `read-xml.js` error). This service: 8/8 tests. Monolith: 567/567 (unchanged count -
  this batch only added dual-write hooks to two already-existing functions; no route file
  changed). `helm lint`/`template`, `terraform validate`, and `actionlint` all clean.
- **What this unblocks**: confirms the "check every table's real consumers before assuming a
  shape" discipline the rest of the live-scoring-engine decomposition needs - `career_trajectories`
  (Batch 30, next) and the shadow-weighting cluster's tables (Batch 31) both need the same
  per-table consumer audit, not an assumption carried over from this batch or Batch 28.

## 6o. Career Intelligence Service (Batch 30) - one service, two different ownership shapes

The sixth extracted slice of the Matching domain - `career_trajectories` (job-sequence
normalization, progression/transition analysis, stability/domain analysis, trajectory embedding,
rule-based future-role prediction), computed from `candidates.work_history` by the ported
`src/matching/careerIntelligence/*.ts` pipeline (6 files: `jobSequence.ts`, `progression.ts`,
`stability.ts`, `trajectoryEmbedding.ts`, `futureRolePrediction.ts`,
`computeCareerTrajectory.ts`).

- **The real nuance this batch had to get right, predicted by Batch 29's own closing note**: the
  per-table consumer audit came back *differently* for the two tables this service needs, forcing
  two different cutover shapes inside one service:
  - `career_trajectories` (this service's own output table) - **independent computation,
    shadow-validated**, the Batch 26/27 shape, NOT Batch 29's mirror shape. The monolith's own
    `career_trajectories` table has real, live (if fire-and-forget) readers still on the monolith
    - `careerWeighting.ts:134` (part of the real shadow-scoring pipeline that runs on every
    swipe/recruiter-review decision) and `explainability/computeExplanation.ts:61` (the real
    recruiter-review explanation endpoint) both call `db.getCareerTrajectory()` directly. Mirroring
    the monolith's row would conflict with this service's own independently-computed version of
    the same row - same conflict class as Batches 26/27's owned tables. So this service's copy is
    populated only when the monolith's shadow-validation client triggers it; the monolith's table
    and its two real readers are untouched.
  - `role_profiles` (an input dependency, needed by `resolveJobRole`/`findLexicalRoleMatch` and
    `predictNextRoles`) - **dual-write mirror**, the Batch 29 shape. This is the THIRD independent
    mirror of `role_profiles` in this migration (Role Intelligence Service's own from Batch 29,
    plus this one) - `src/dualWrite.ts`'s `upsertRoleProfile`/`patchRoleProfile` now fan out to
    both target databases, no `db.ts` call-site changes needed (same "multiple independent
    mirrors of the same source table" pattern already used for `skill_nodes` across Batches
    26/27).
- **Cross-service FK dropped**: `career_trajectories.candidate_id`/`company_id` referenced
  `candidates(id)`/`companies(id)` in the monolith's own schema - both dropped to plain scoping
  integers in this service's own migration. `role_profiles` has no FK in the monolith's own
  `schema.sql` - nothing to drop there.
- **No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`, no embedding-service dependency** -
  this service has no user-facing HTTP surface; its only caller is the monolith's own
  `src/careerIntelligenceServiceShadow.ts` (drop-in replacement for
  `computeCareerTrajectoryInBackground`, gated behind `SHADOW_CAREER_INTELLIGENCE_ENABLED`, off by
  default). Unlike Role/Reasoning services, this pipeline calls no embedding service at request
  time - the trajectory embedding is a deterministic, hand-computed 16-dim vector.
- **Real, end-to-end verification** (`scripts/_tmp-batch30-smoketest.ts`, deleted after use):
  1. Called the real (unchanged) monolith `db.upsertRoleProfile` with `DUAL_WRITE_ENABLED=true`,
     confirmed the row fanned out correctly to this service's own `role_profiles` mirror (the third
     independent target).
  2. Called the real `careerIntelligenceServiceShadow.computeCareerTrajectoryInBackground` against
     a synthetic candidate with a real work history, with `SHADOW_CAREER_INTELLIGENCE_ENABLED=true`
     pointed at the real running service. The monolith's own computation correctly returned `null`
     (its `career_trajectories` insert hit its real FK constraint - the synthetic candidate id
     doesn't exist in the monolith's `candidates` table), while this service's own copy (no FK)
     computed and stored a real, correct trajectory (`progression_type: ic_track`,
     `seniority_trend: ascending`, a 16-dim embedding). The resulting shadow-comparison divergence
     log is the CORRECT behavior for this test setup, not a bug - it proves the comparison logic
     itself works; a real candidate id (present in both databases) would agree. Both database rows
     removed afterward.
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the gateway (only the
  same pre-existing, unrelated `read-xml.js` error, present since the initial commit). This
  service: 6/6 tests. Monolith: 567/567 (unchanged count - this batch only swapped one import
  across 3 call sites in `candidate.routes.ts`; no new monolith-side unit test, following the
  established Batches 26/27/28 precedent of validating thin shadow-client wrappers via real
  smoke-test scripts instead). Gateway: 53/53 (unchanged - no gateway routing added). Real
  `docker build`/`docker run`/`curl` smoke test against Postgres via `host.docker.internal`. `helm
  lint`/`template`, `terraform validate`, and `actionlint` all clean.
- **What this unblocks**: confirms the split-shape pattern (a service can simultaneously own an
  independently-computed output table AND a dual-write mirror of an input dependency) is workable
  without added complexity to the dual-write fan-out mechanism itself - `getCareerIntelligenceServicePool()`
  slots into the existing `upsertRoleProfile`/`patchRoleProfile` fan-out exactly like
  `matching-skill-discovery-service`'s second `skill_nodes` target did in Batch 27. The
  shadow-weighting cluster's tables (Batch 31, next) need their own fresh per-table consumer audit
  - not an assumption carried over from this batch.

## 6p. Matching Evaluation Service extended - shadow-weighting cluster (Batch 31) - resumed and completed after an interrupted first attempt

This batch has an unusual history worth recording explicitly: a first attempt at it had already
been made and left in the working tree - migration `003_shadow_cluster.up.sql`, the four ported
signal modules, and `shadowScoring.ts` all existed, well-formed and consistent with this
migration's established conventions, before this batch's own work began. That attempt's own
validation check had failed (a real-data score-equivalence comparison, exit code 4), and it was
never finished: `db.ts` was missing every new read/write function the ported files needed (a
genuine compile-time gap - `npx tsc --noEmit` failed with five `TS2339` errors the moment this
batch picked the work back up), there was no `/internal/*` endpoint, no monolith-side shadow
client, and the two real call sites (`swipe.routes.ts`, `recruiter-review.routes.ts`) still
imported the unmodified original. Rather than discard and redo the well-formed parts, this batch
verified them, completed what was missing, and found two further real bugs in the process - see
below. This is recorded here as a caution: partially-complete work in this repository can look
finished at a glance (right file names, right structure, right header comments) while still having
a real, load-bearing gap - the same "verify, don't assume" discipline this entire migration has
applied to every table's consumer list applies equally to inherited code, including this batch's
own inherited starting point.

Ports `shadowScoring.ts` (the four-signal orchestrator) and its four signal modules -
`proficiencyWeighting.ts`, `careerWeighting.ts`, `recencyWeighting.ts`, `reasoningWeighting.ts` -
byte-identical logic, unblocked by Batches 26/27 (`skill_nodes`), 29 (`role_profiles`), and 30 (the
`career_trajectories`/`role_profiles` split-shape precedent, reused directly here).

- **Two shapes, four mirrors, one owned table** - see `matching-evaluation-service/README.md`'s
  "Batch 31" section and `003_shadow_cluster.up.sql`'s header comment for the full per-table
  reasoning. In short: `skill_nodes`/`role_profiles` get a fourth and third independent mirror
  target respectively (same fan-out pattern as every prior multi-mirror table); `career_trajectories`/
  `reasoning_conclusions` each get their FIRST **passive** mirror anywhere in this migration
  (plain upsert-by-id / transactional-replace copies of the monolith's real, complete tables -
  unlike career-intelligence-service's and matching-reasoning-service's own sparse,
  independently-computed copies of the same two tables); `shadow_weighting_computations` is owned
  outright, written directly by this service's own ported orchestrator, deliberately never merged
  with the pre-existing `proficiency_shadow_scores` mirror (Batch 25) - same "independent
  computation, shadow-validated" shape as every prior owned-output-table batch.
- **Real bug #1, found by `tsc`**: `matching-evaluation-service/src/db.ts` was missing
  `findSkillNodeByAlias`, `getAllRoleProfiles`, `getCareerTrajectory`, `getReasoningConclusions`,
  and `insertShadowWeightingComputation` entirely - the inherited attempt's migration and ported
  logic existed, but the data-access layer connecting them to the new tables did not. Added,
  modeled on the equivalent read functions in role-intelligence-service/matching-reasoning-service's
  own `db.ts`.
- **Real bug #2, found by reading `dualWrite.ts`'s new `replaceReasoningConclusions` against the
  schema**: `derived_from` (a plain `VARCHAR(60)`, confirmed against `schema.sql:1090` and
  `src/types.ts:664/677`) was included in that function's `jsonColumns` set, meaning every mirrored
  row would have had its `derived_from` value double-JSON-encoded (wrapped in literal escape
  quotes) instead of stored as the plain string the monolith itself stores. Only `evidence_chain`
  is a real JSONB column on this table. Fixed; confirmed via the real smoke test's dedicated check
  that a mirrored row's `derived_from` comes back as an unmodified string.
- **Real bug #3, found by this batch's own new test**: `insertShadowWeightingComputation`
  returned the raw `INSERT ... RETURNING *` row without NUMERIC coercion - Postgres returns
  NUMERIC columns as strings via node-postgres, and this row is sent directly over HTTP to the
  monolith's shadow-comparison client, which does a strict JSON-equality diff against real JS
  numbers. An uncoerced string would have made every single real shadow comparison for this
  service spuriously report a divergence, regardless of whether the actual computation agreed -
  very plausibly the root cause (or a contributing one) of the inherited attempt's own failed
  validation check. Fixed with the same `coerceProficiencyShadowScoreRow`-style coercion already
  used elsewhere in this file.
- **Monolith side**: `src/matchingEvaluationServiceShadow.ts` (new) - drop-in replacement for
  `shadowScoring.ts`'s `logShadowScoresInBackground`, gated behind
  `SHADOW_MATCHING_EVALUATION_ENABLED` (off by default). `swipe.routes.ts`/
  `recruiter-review.routes.ts` now import it instead of the local module.
- **Real, end-to-end verification** (`scripts/_tmp-batch31-smoketest.ts`, deleted after use):
  confirmed dual-write fan-out landed correctly on all four mirror targets, including a dedicated
  assertion that `derived_from` is stored as a raw string (bug #2's regression check). The initial
  shadow-comparison run showed a real, reproducible divergence on `recency_role_expectation`
  (`"low"` vs `"medium"`) - traced to this service's `role_profiles` mirror being genuinely empty
  (migration just applied, backfill never yet run for real data), not a logic bug: the monolith's
  own database has a real seeded `backend_engineer` role, this service's mirror did not yet.
  Running `scripts/backfill-matching-evaluation-service.ts` for real (185 skill_nodes, 9
  role_profiles, 28 reasoning_conclusions rows) resolved it - a re-run of the exact same shadow
  comparison then logged agreement. `scripts/validate-matching-evaluation-service-sync.ts` (also
  extended this batch for the four new tables) confirmed full sync afterward.
- **Backfill/validate-sync scripts extended**: both scripts gained the four new tables;
  `shadow_weighting_computations` deliberately excluded from both (owned, not mirrored - same
  reasoning as every prior batch's owned tables).
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the gateway (only the
  same pre-existing, unrelated `read-xml.js` error). This service: 18/18 tests (4 new, covering the
  `/internal/compute-shadow-weighting` endpoint and both bugs' regressions). Monolith: 547/567
  passed, 20 skipped - the 20 skips are two pre-existing, unrelated test files failing to load a
  Postgres extension DLL (`pg_trgm.dll`) blocked by a local Windows Application Control policy,
  confirmed unrelated to this batch (neither file references any shadow-weighting code, and both
  predate this batch's changes). Gateway: 53/53. Real `docker build`/`docker run`/`curl` smoke
  test. `helm lint` clean - no Helm/Terraform/CI changes were needed this batch (this service's
  infra has existed since Batch 24 and required no new port, env var, or CI matrix entry).
- **What this unblocks**: confirms the extraction shape (skill/role/career mirrors,
  independent-computation output tables) reused directly in Batch 33 next. The remaining planned
  slice - `confidenceService.ts`/`embeddingIndex.ts` - still needs its own fresh per-file consumer
  audit before being assigned anywhere; see §6q's own finding on why that audit concluded it does
  NOT belong in Candidate Service (or any new service) as originally planned.

## 6q. Dynamic Weighting / Explainable Matching Service (Batch 33) - the cleanest extraction in this migration, and a Batch 32 that correctly did NOT happen

Before this batch, the plan (carried over from the pre-Batch-29 audit) named Batch 32 as
"`confidenceService.ts`/`embeddingIndex.ts` into Candidate Service." A fresh consumer audit,
following the same discipline every batch since 29 has applied, found this plan didn't hold up:

- **Batch 32 was correctly NOT executed.** `computeCandidateConfidence` writes a JSONB blob
  directly into a column (`confidence_profile`) on the monolith's own `candidates` table, as part
  of the single `INSERT` that creates a candidate row (`candidate.routes.ts`) - there is no
  separate table to own or mirror. `indexCandidateEmbeddingInBackground`/
  `indexJobEmbeddingInBackground` (`embeddingIndex.ts`) write embedding columns directly onto
  `candidates`/`jobs` themselves via `db.updateCandidate`/`db.updateJob`. `candidate-service`
  (Batch 16) owns a completely different table (`candidate_accounts` - the candidate's own
  self-service login/profile), not `candidates` (confirmed via `candidate-service/migrations/
  001_initial_schema.up.sql`) - there is no existing service these two files cleanly extend. Both
  files write directly into the two tables the live-scoring engine (`services.ts`/`matchingApi.ts`)
  reads on every real match computation - the same "inseparable live-scoring core" flagged at the
  start of this session as needing its own careful design pass, not a mechanical per-file batch.
  Forcing an extraction here (e.g. a partial dual-write of just these two columns) would have been
  exactly the kind of rushed, under-tested change to the hot path this session's own stated
  boundary rules out. `confidenceService.ts`/`embeddingIndex.ts` remain bundled with that
  still-unscoped live-scoring-core work, not extracted.

Batch 33 itself, by contrast, turned out to be the cleanest extraction of the whole migration:

- Ports `resolveSkillTiers`, `computeSeniorityAdjustedWeights`, `computeDynamicSkillScore`
  (`dynamicWeighting.ts`), `buildMatchExplanation` (`explainability.ts`, **singular** file),
  and `hybridRetrieveCandidates` plus its three retrieval strategies (`retrieval.ts`) -
  byte-identical logic. **Genuinely zero real traffic today**: every one of these is reachable on
  the monolith only via `matchingApi.ts`'s `weighting: 'dynamic'` / `retrieval` options, and
  `grep -rln "'dynamic'" src scripts` / `grep -rn "retrieval: {" src` both return only the files
  that *define* the options, never a call site that sets either. Confirmed further:
  `calculateDynamicMatchScoresBatch` (the one function that would actually invoke this whole
  cluster) itself has exactly one reference outside its own definition - `matchingApi.ts`'s
  never-triggered conditional call.
- **The real distinction this batch had to get right**: `src/matching/explainability.ts`
  (singular, ported here, confirmed dormant - imported only by `services.ts`'s
  `calculateDynamicMatchScoresBatch`) and `src/matching/explainability/` (**plural** folder, NOT
  touched) are two separate, unrelated things sharing a name prefix. The plural folder
  (`computeExplanation.ts`, `concernDetection.ts`, `narrativeGeneration.ts`) is genuinely live -
  reachable from three real route files (`candidate-internal.routes.ts`,
  `candidate-jobs.routes.ts`, `recruiter-review.routes.ts`), and `computeExplanation.ts` calls
  `db.getCareerTrajectory()` directly. Conflating the two by name would have extracted live,
  traffic-serving code under the same "safe, zero-risk" umbrella as the genuinely dormant trio -
  caught by reading both, not assuming from the similar file names.
- **No owned table - a first for this migration.** Every function ported here is a pure
  computation over data the caller already has (plus this service's own mirrors) - there is no
  result row to store, only a computed response. Owns three read-only, dual-written mirrors: `skill_nodes`
  (FOURTH independent target, alongside matching-reasoning-service/matching-skill-discovery-service/
  matching-evaluation-service - Batches 26/27/31), `skill_edges` (SECOND independent target,
  alongside matching-reasoning-service - Batch 26), `role_profiles` (FOURTH independent target,
  alongside role-intelligence-service/career-intelligence-service/matching-evaluation-service -
  Batches 29/30/31).
- **No shadow client, no trigger to swap at all** - the same shape as Role Intelligence Service
  (Batch 29), for the same reason: nothing calls the ported functions today, so there is nothing to
  compare against and no call site to swap. This service's own `/internal/*` endpoints (one per
  ported function, taking full input in the request body) are ready for whichever future caller
  needs them.
- **Real, end-to-end verification** (`scripts/_tmp-batch33-smoketest.ts`, deleted after use):
  confirmed dual-write fan-out landed correctly on all three mirror targets - the 4th `skill_nodes`
  target, the 2nd `skill_edges` target (respecting its real FK to `skill_nodes` on the target side),
  and the 4th `role_profiles` target.
- **Validation**: `tsc --noEmit` clean on the monolith, this service, and the gateway (only the
  same pre-existing, unrelated `read-xml.js` error) - both clean on the first attempt, no bugs
  found this batch (unlike Batch 31's inherited work, this was built fresh end-to-end in one pass).
  This service: 11/11 tests (5 covering every `/internal/*` endpoint, including a real graph-related
  skill match via a seeded `skill_edges` row and a real role-profile lexical match). Monolith:
  547/567 passed, 20 skipped - the same two pre-existing, unrelated `pg_trgm.dll`
  Application-Control-blocked test files as Batch 31, confirmed unrelated (neither references
  anything this batch touched). Gateway: 53/53. Real `docker build`/`docker run`/`curl` smoke test.
  `helm lint`, `terraform validate`, and `actionlint` all clean.
- **What this closes out**: this is the last currently-planned batch drawing from the
  "background-intelligence super-cluster" identified in the pre-Batch-29 audit. What remains
  unscoped is exactly what this session flagged as needing its own dedicated design pass from the
  start: the inseparable live-scoring core itself (`services.ts`'s live-scoring lane,
  `matchingApi.ts`, `similarity/locationDistance.ts`, `parseCandidateFields.ts`, `featureStore.ts`)
  plus `confidenceService.ts`/`embeddingIndex.ts` (this batch's own finding - tightly coupled to
  `candidates`/`jobs`, not separable without extracting that core too).

## 6r. Full-migration batches (Job Service, Candidate Core Service, Matching Decision Service, Gateway/Nginx cutover)

Picks up after §6q with the pieces of the remaining monolith that are safely separable *without*
touching the live-scoring engine, plus the infrastructure cutover §7 previously listed as never
attempted.

- **Job Service** (new) - dual-written, read-only mirror of `jobs`. Monolith stays sole writer
  (`job.routes.ts` unchanged) - `job.routes.ts`'s own `GET /jobs/:id` fuses plain job data with a
  live call into the scoring engine in the same request, so a full cutover isn't safe yet. Real
  `/internal/jobs`, `/internal/jobs/:id` reads.
- **Candidate Core Service** (new) - same shape, mirrors `candidates` (the recruiter-facing,
  resume-parsed profile - distinct from `candidate-service`'s `candidate_accounts`). Not a
  cutover for the identical reason: `candidate.routes.ts`'s create/update path calls
  `confidenceService.ts`, `embeddingIndex.ts`, RAG indexing, unknown-skill discovery, and
  reasoning computation in the same request.
- **Matching Decision Service** (new) - mirrors `swipes`, `recruiter_notes`,
  `detailed_scoring_reports` - OUTCOME data only, recorded once a real decision has already been
  made by the unchanged monolith code. Deliberately does not touch the scoring computation that
  produces the score being recorded. Found and fixed a real bug in the process: `schema.sql`
  documents `swipes.action` as `INTEGER`; the live database's real column (verified directly via
  `information_schema.columns`, not assumed from the doc) is `NUMERIC` - an undocumented drift
  from an earlier migration (`migration-swipes-action-numeric.sql`) that `schema.sql`'s own
  `CREATE TABLE` statement was never updated to reflect. Caught by testing against the real
  database rather than trusting the schema doc.
- **Gateway/Nginx cutover** - `docker-compose.yml` now runs all 18 Tier 0 services plus
  `api-gateway`, each wired to its own database (native Postgres via `host.docker.internal`, same
  as the monolith) and to `MONOLITH_INTERNAL_URL`/sibling-service URLs where its own config
  requires them. `nginx/conf.d/tejoma.conf`'s single upstream now points at `api-gateway`
  (`tejoma_gateway`) instead of `app` directly - no location block needed to change, since the
  Gateway's own strangler-fig fallback (`MONOLITH_URL`) preserves the exact "everything reaches
  something that responds" behavior nginx→`app` always had. This is the change that actually
  activates every dual-write mirror and gateway-routed service built across this whole migration -
  real requests now flow nginx→Gateway→(Tier 0 service or monolith fallback) for the first time.
  `docker compose config` and `nginx -t` (against the real `internal` network) both validate
  clean. Prometheus now scrapes all 18 services' real `/metrics` endpoints (previously only the
  monolith was scraped, despite every service exposing real prom-client instrumentation since its
  own batch).
- **What's still NOT cut over even after this**: 9 of the 18 Tier 0 services running in Compose
  (`job-service`, `candidate-core-service`, `matching-decision-service`,
  `role-intelligence-service`, `career-intelligence-service`, `dynamic-weighting-service`,
  `matching-reasoning-service`, `matching-bge-shadow-service`, `tenant-directory-service`) are
  **not** in `api-gateway`'s routing table - they run, receive live dual-written data, and are
  independently validated, but no real request reaches them yet. This is intentional, not an
  oversight: several (Reasoning, Skill Discovery's promotion path, BGE Shadow) are shadow-
  validation-only by design; the rest simply don't have a real caller lined up yet (see each
  service's own README's "not yet gateway-routed" section for its specific reason).
- **The live-scoring engine remains untouched**, by design, unchanged from every prior batch's
  stated boundary.

## 6s. Real bring-up of the full stack (Batch 38, continued) - two pre-existing bugs found and fixed, cutover verified live

§6r's cutover was validated with `docker compose config` and `nginx -t` only - static checks, not
a running system. This batch actually ran `docker compose up -d` for the full stack (21
containers: monolith + 18 Tier 0 services + api-gateway + nginx, plus the pre-existing
`jd-nlp-service`/`matching-ml-service` Python sidecars) and fixed what broke:

- **`identity-service` refused to start**: `FATAL: IDENTITY_JWT_PRIVATE_KEY /
  IDENTITY_JWT_PUBLIC_KEY are not set`. This is a deliberate, correct guard in
  `identity-service/src/config/keys.ts` - `NODE_ENV=production` (set for every Tier 0 service in
  `docker-compose.yml`, matching the monolith's own convention) refuses to fall back to an
  ephemeral dev keypair and requires a real, persisted RS256 signing key (meant to come from AWS
  Secrets Manager in real production). Fixed by generating a real local RSA-2048 keypair and
  adding it to `.env.local` as `IDENTITY_JWT_PRIVATE_KEY`/`IDENTITY_JWT_PUBLIC_KEY` - simulating
  what Secrets Manager provides in production, not weakening the check or switching the service to
  development mode.
- **`matching-ml-service` (pre-existing Python sidecar, not part of this migration's own service
  list) crashed on import**: `ModuleNotFoundError: No module named 'ranker'`. Root cause:
  `python-services/matching-ml-service/Dockerfile`'s `COPY main.py ensemble.py embeddings.py ./`
  line never copied `ranker.py` into the image, even though `main.py` imports it and the file has
  existed in source since the service was first committed (`552be45`, before this migration
  effort began). One-line fix: added `ranker.py` to the `COPY` line. This blocked the *entire*
  stack from starting (the monolith `app` depends on `matching-ml-service` being healthy, and
  `api-gateway` depends on `app`), not anything specific to the gateway cutover.
- **`nginx` initially still returned `502 Bad Gateway`** for every request after both fixes above
  and a clean `docker compose up`. Cause: the `nginx` container itself had been running
  continuously since before `api-gateway` existed in `docker-compose.yml` (`Up 2 days` in `docker
  compose ps`) - nginx resolves a static `upstream { server api-gateway:4000; }` directive once at
  startup, so it never picked up either the config file edit (§6r) or the new container's DNS
  entry. Fixed with `docker compose restart nginx`, not a rebuild.
- **Real end-to-end verification, after all three fixes**, from outside the Docker network exactly
  as a browser would reach it:
  - `https://localhost/health` (via nginx → api-gateway) returned the gateway's own live aggregate
    health check, reporting `"status":"ok"` for all 10 routed upstreams (identity,
    platform-governance, jd-parser, candidate, chat, resume, recruiting, analytics,
    matching-evaluation, monolith) - not a static fallback, a genuine live upstream poll.
  - `https://localhost/api/auth/csrf-token` (a gateway-routed path → identity-service) and
    `https://localhost/api/jobs` (an unrouted path → monolith fallback) both returned real
    application responses (`401 {"error":"Authentication required"}`) with real Express/helmet
    security headers (`x-request-id`, `strict-transport-security`, etc.) - not a 502 stub, proving
    both the routing table AND the strangler-fig fallback work against live traffic.
  - Final `docker compose ps`: all 21 application containers + monitoring sidecars report
    `(healthy)`.
- Net effect: §6r's cutover is no longer just config-validated - it has been exercised with real
  HTTP requests against a fully running stack, and both bugs this uncovered are fixed at the root
  cause (a missing production secret and a missing file in a `COPY` line), not worked around.

## 6t. Matching Scoring Service - the live-scoring-engine extraction, shadow-validation only

Picks up the one piece §7 has named as untouched since the very first batch of this migration:
`src/matching/services.ts`'s live-scoring core (`computeMatchFeatures`, `calculateMatchScoresBatch`,
`calculateMatchScoresForJobsBatch`) - the actual computation behind every `match_score` a recruiter
or candidate has ever seen. This batch extracts it, but deliberately does NOT cut it over - see
`matching-scoring-service/README.md`'s "Why the cutover mechanism mirrors matching-reasoning-
service, not matching-bge-shadow-service" for the full reasoning on why shadow-validation, not a
direct cutover, is the correct move for a computation this consequential.

- **Matching Scoring Service** (new) - ports `computeMatchFeatures`/`calculateMatchScoresBatch`/
  `calculateMatchScoresForJobsBatch` and their full pure-computation dependency chain
  (`algorithms/{jaccard,cosine,euclidean,levenshtein,ml-models}.ts`,
  `matching/similarity/locationDistance.ts`, `matching/parseCandidateFields.ts`, and the slice of
  `jd-parser/{types,matcher/trie,dictionaries/locations.dictionary,tiers/regexTier}.ts` those two
  depend on, copied verbatim from `jd-parser-service`). One real deviation from the monolith's
  copy: `activeModelType` is threaded through as an explicit parameter instead of the original's
  shared mutable module `let`, since every call here is a per-request shadow comparison that must
  reproduce the exact model type the monolith used for that specific request - a shared binding
  would race under concurrent requests in a way the monolith's admin-toggle-driven original never
  does. Deliberately NOT ported: Gemini summary generation (never a correctness signal, and would
  double live API cost for zero benefit - `summary` is always `''`), `calculateDynamicMatchScoresBatch`
  (the monolith's own module doc already states this path has zero live callers), and
  `trainModelOnStartup` (a batch job, not the scoring hot path).
- **Shape**: the monolith's own `src/matching/services.ts` is completely unchanged and remains the
  sole source of every real score. A new `src/matchingScoringServiceShadow.ts` (mirrors
  `reasoningServiceShadow.ts` exactly) fires a non-blocking comparison AFTER each of the two real
  functions returns its result, gated behind `SHADOW_SCORING_ENABLED` (set to `true` in
  `.env.local` for this batch specifically - see below for why, unlike every other shadow flag in
  this repo, which stay off). Comparison is numeric-only (`feature_score`/`embedding_score`/
  `ml_score`/`final_score` + the four breakdown sub-scores) and logs agreement at `debug`,
  divergence at `error` - never throws, never affects the real response.
- **Verified with real data, not synthetic fixtures**: ran the monolith's actual
  `calculateMatchScoresBatch`/`calculateMatchScoresForJobsBatch` against real jobs/candidates
  already in the database (`db.getAllJobsUnscoped`/`getAllCandidatesUnscoped`) with
  `SHADOW_SCORING_ENABLED=true`, both natively and through the full Docker network (`app` container
  → `matching-scoring-service` container). Every comparison logged genuine agreement - the ported
  formulas reproduce the monolith's real scores exactly (e.g. `final_score: 14, 58, 14` for one
  real job against three real candidates, matched independently by both services).
- **Why `SHADOW_SCORING_ENABLED=true` here, unlike every other shadow flag** (`SHADOW_REASONING_ENABLED`
  etc., all left off in `.env.local`): the whole point of this specific extraction is to accumulate
  real shadow-validation history before any future cutover decision, and it's safe to leave on by
  the same hard rules every other shadow module in this repo already follows (never blocks, never
  throws, never affects the real response). The user can revert this to the same off-by-default
  convention as every other flag at any time with no code change.
- **A real, previously-undetected bug found and fixed while wiring this in**: every one of the 17
  Tier 0 database-owning services in `docker-compose.yml` - not just this new one - was silently
  connecting to `tejoma_recruiting` (the monolith's own database) instead of its own dedicated
  database. Root cause: `env_file: .env.local` in Compose always resolves to the ROOT `.env.local`
  (which sets `DB_NAME=tejoma_recruiting` for the monolith), never to a service's own directory,
  and not one of the 17 service blocks overrode `DB_NAME` in its own `environment:` section - so
  every one of them silently inherited the monolith's database name instead of falling through to
  its own `src/db.ts` default (which only ever applies when `DB_NAME` is completely unset). Every
  `/health` check kept reporting `ok` throughout, because it only ever ran `SELECT 1`, which
  succeeds against any reachable database - this masked the bug completely until a real write
  against `matching-scoring-service`'s own table failed with `relation "scoring_computations" does
  not exist`. Fixed by adding an explicit `DB_NAME:` override to all 17 affected service blocks
  (see `docker-compose.yml`'s Tier 0 header comment for the full explanation, updated in place) and
  recreating every affected container; re-verified afterward that each container's resolved
  `DB_NAME` and a real query against its own known table are now correct (spot-checked
  `matching-scoring-service` end-to-end and `role-intelligence-service`'s `role_profiles` table).
- **Not gateway-routed**, same reasoning as `matching-reasoning-service`/`matching-bge-shadow-service`
  - no user-facing HTTP surface, only the monolith's own shadow client calls it.
- **The monolith's own live scoring remains untouched**, by design - this batch adds a parallel,
  independently-computed check on it, nothing more.

## 6u. Remaining-monolith migration, Step 1 - ML admin surface gets a real gateway front door

Full audit (fresh Explore-agent pass + a Plan-agent stress-test that caught several wrong initial
assumptions) found exactly 7 monolith route files with ZERO gateway coverage, plus 7 core
matching-engine files never extracted anywhere - see the approved migration plan for the full
inventory and phased order. This batch is Step 1 of that plan: the smallest, zero-dependency piece.

- **`matching-scoring-service` gains a real, staff-authenticated, gateway-routed HTTP surface** -
  `GET/POST /api/ml/config`, `POST /api/ml/train`, `GET /api/ml/model/status`, `GET
  /api/ml/model/versions` (moved from `src/api/ml.routes.ts`, the 4 leaf paths matching-evaluation-
  service's own comments always named as staying on the monolith). New `src/middleware/
  auth.middleware.ts` (byte-identical staff-HS256 pattern already proven in 4 other services),
  new `src/routes/mlAdmin.routes.ts`, mounted at `/api` with the FULL leaf paths (`/ml/config` etc.)
  - the gateway forwards the original path unstripped, same convention every other service's own
    route mounting already follows (matching-evaluation-service's `/api` + `/ml/evaluate` is the
    reference; an early version of this batch mounted at `/ml` with short paths and got real 404s
    end-to-end until caught and fixed).
- **Deliberately NOT a real ownership transfer yet**: `activeModelType`/`trainModelOnStartup`
  remain 100% monolith-owned state, unchanged. A new `src/api/matching-scoring-internal.routes.ts`
  (mounted at `/internal/matching-scoring`, same network-boundary-trust convention as every other
  `*-internal.routes.ts`) exposes thin wrappers around the exact same functions `ml.routes.ts`
  always called; `matching-scoring-service`'s new `/ml/*` handlers are pure proxies
  (`services/monolithClient.ts`, modeled on `recruiting-service`'s own copy) that forward to it.
  Reasoning: the monolith's own live-scoring engine is still the only thing that reads
  `activeModelType` for real production scoring today (this service's own scoring functions take
  `modelType` as an explicit per-request parameter, never a shared value) - moving the WRITE
  authority here before the scoring engine itself is cut over (Step 2) would silently decouple "an
  admin changes the model" from "what real scoring actually uses." Move the edge first, migrate
  authority later - the same strangler-fig discipline used everywhere else in this migration.
- **Real, live verification, not just tests**: after fixing the route-mounting bug above, ran the
  actual browser-equivalent path (`https://localhost` → nginx → api-gateway → matching-scoring-
  service → monolith) for all 4 endpoints with a real signed staff JWT. `GET /api/ml/model/status`
  reported real data (109 real swipes counted from the live database); `POST /api/ml/config`
  really persisted a value change and was confirmed by a follow-up `GET` (then restored to its
  original value); `POST /api/ml/train` ran a genuine ensemble retraining pass against
  `python-services/matching-ml-service` and returned `ensembleTrained: true, trainedSampleCount:
  107`; a request with no cookie correctly got `401`; `POST /api/ml/train/ranking` (the sibling
  leaf on matching-evaluation-service) was confirmed to still route correctly and was NOT swallowed
  by the new `/api/ml/train` entry's `exact: true` guard.
- Also fixed along the way: `api-gateway/src/routes/health.routes.ts`'s aggregate `/health` never
  included `matching-scoring-service` (or, pre-existing and left alone since out of scope,
  `matching-skill-discovery-service`) in its upstream poll - added the former.
- Full regression: monolith 520/520, `matching-scoring-service` 19/19, `api-gateway` 61/61 (both
  with new tests added for the new surface - auth-gating, proxy success/failure, and the
  `/api/ml/train` vs `/api/ml/train/ranking` collision guard specifically), `tsc --noEmit` clean
  across all three, `docker compose config` clean.

## 6v. Remaining-monolith migration, Step 2 - completing the scoring engine's callable surface

Ports `matching/matchingApi.ts` (the "Unified Matching API" orchestration layer every real scoring
surface goes through) and `matching/featureStore.ts` into `matching-scoring-service`, making it a
complete, independently-callable ranking engine for the first time - not just the pure-math core
Batch [prior session] ported. Scope was narrowed twice from the original plan, both times by real
evidence, not assumption:

- **`embeddingIndex.ts` excluded** - on inspection it's entirely write-side (`db.updateCandidate`/
  `db.updateJob`, called when a candidate/job is first created), never read by anything this
  service does. Its real home is candidate-core-service's/job-service's own write path (Steps 3/4),
  not here - reclassified, not dropped.
- **`weighting: 'dynamic'` and `retrieval` options excluded from the `matchingApi.ts` port** -
  `grep -rn "weighting: 'dynamic'"` and `grep -rn "retrieval: {"` across the whole monolith both
  return zero hits; the monolith's own module docs already call both strictly opt-in with no real
  caller. Porting a `role_profiles`/`skill_nodes`/`skill_edges` cross-service read chain for code
  nothing calls would have been speculative work the migration's own rules ("do not randomly
  redesign", "reuse existing... don't create duplicate services") argue against. Every option any
  real call site actually passes (`tier`, `skipGeminiSummary`-equivalent, `persist`) is preserved
  exactly.
- **`confidenceService.ts`/`explainability/` (computeExplanation.ts + its narrative/concern-
  detection helpers) deferred, not silently dropped.** Both are real, but neither blocks anything
  in this migration's remaining steps: `confidenceService.ts` is dependency-free and belongs more
  naturally inside candidate-core-service directly (Step 3) than routed through here first.
  `computeExplanation.ts` needs a new cross-service read chain (`career_trajectories` from
  career-intelligence-service, `reasoning_conclusions` from matching-reasoning-service, plus a real
  `skill_nodes` mirror for `canonicalizeSkill`) AND its only real caller
  (`recruiter-review.routes.ts`) already gracefully degrades to `explanation: null` on failure -
  genuinely substantial standalone work with zero risk to defer, tracked as explicit follow-up
  rather than rushed into this batch.
- **`match_scores`/`match_features` become a real, full ownership cutover in this service**, not a
  mirror - confirmed via a repo-wide grep that neither table has EVER had a read consumer anywhere
  in the codebase (both always write-only historical logs for future training work that was never
  built), the same reasoning that made `bge_retrieval_shadow_comparisons`'s cutover safe in this
  migration's very first batch. New migration `002_match_scores.up.sql` (cross-service FKs
  dropped, same pattern as `matching-decision-service`'s `swipes`/`recruiter_notes`). New endpoints:
  `POST /internal/rank-candidates-for-job`, `/rank-jobs-for-candidate`, `/score-candidate-for-job`,
  plus the two synthetic-object adapters (`/synthetic-candidate-from-account`,
  `/synthetic-job-from-query`) so a future caller doesn't need to reimplement that trivial mapping.
- **Real, live verification**: ran an actual `rank-candidates-for-job` call over the real Docker
  network (`app` container → `matching-scoring-service`) with `tier: 'full'`, `persist: {...}` set,
  and confirmed BOTH the ranked response AND real rows landing in `match_scores` (`rank: 1`,
  correct `final_score`) and `match_features` (`source`/`tier` correct) - not just a 200 response.
- New tests: `tests/matchingApi.routes.test.ts` (9 tests - 400 validation, heuristic tier with zero
  persistence, full tier with real sort-order + real persistence assertions, single-candidate
  scoring, both synthetic adapters). Full service suite: 28/28. Monolith untouched this step (no
  monolith files modified), so its own 520/520 regression still holds unchanged from Step 1.

## 6w. Remaining-monolith migration, Step 3a - Candidate Core Service's real cutover (reads) + write proxy

`GET /api/candidates`, `GET /api/candidates/:id` gateway-routed to `candidate-core-service` for
the first time - a real, safe cutover, not a proxy, since its dual-written mirror (kept fresh by
the monolith's own existing `dualWrite.upsertCandidate`/`deleteCandidateMirror` hooks) already
holds real, live-synced data. `POST /api/candidates`, `DELETE /api/candidates/:id`, `POST
/api/bulk-upload-candidates`, `POST /api/candidates/import` also gateway-routed here, but proxy
through to the monolith - see below for why.

- **A real, previously-latent bug found and fixed before this could ship**: `candidate-core-
  service`'s own mirror stores `skills`/`previous_companies`/`certifications` as raw delimited
  strings (the DB's actual storage format), but the monolith's `GET /api/candidates` has always
  applied `mapRowToCandidate` (parsing them into real arrays) before responding - a shape mismatch
  that would have silently broken the frontend (expects real arrays) the moment this cutover
  shipped. Ported `mapRowToCandidate` into `db.ts`, applied it at the new public routes' layer only
  - `internal.routes.ts`'s existing raw-row contract (zero real callers today) is untouched.
- **Writes stay monolith-authoritative, deliberately** - `candidate.routes.ts`'s
  `createCandidateWithSideEffects` (create) and `deleteCandidate` remain the sole writer, still
  triggering the exact same 6 background side effects (RAG indexing, BERT embedding, unknown-skill
  discovery, project intelligence, career trajectory, reasoning). Reason: many OTHER still-monolith
  surfaces (`swipe.routes.ts`, `job.routes.ts`, `recruiter-review.routes.ts`,
  `candidate-search.routes.ts` - none cut over yet) read `candidates` directly from the monolith's
  own database; if writes stopped flowing through the monolith now, all of them would see stale
  data immediately. New `src/api/candidate-core-internal.routes.ts` (monolith) - thin wrappers
  around the exact existing create/delete logic, reused via export
  (`createCandidateWithSideEffects`, `candidatePayloadFromExtracted` now exported from
  `candidate.routes.ts` - the 3 near-identical inline call sites there were also collapsed into
  one shared function as part of this, a pure de-duplication with no behavior change, covered by
  the existing 520-test monolith regression). Same "move the edge first, migrate authority later"
  shape as Step 1's ML admin surface and Step 2's `matching-scoring-service`.
- New `candidate-core-service/src/services/monolithClient.ts` (write proxy), `src/middleware/
  auth.middleware.ts` (staff HS256, this service's first-ever public auth), `src/routes/
  candidates.routes.ts`. Gateway: `/api/candidates` (no hyphen - verified via a real routing test
  that it never collides with `candidate-service`'s `candidate-*` self-service prefixes) and
  `/api/bulk-upload-candidates`.
- Tests: 10 new (`tests/candidates.routes.test.ts` - auth gating, parsed-array assertions against
  real seeded rows, proxy success/400/404/502 paths) + monolith's own regression unaffected.
  Full-suite gotcha caught and fixed: this test file's seed data initially reused
  `company_id: 801`, silently colliding with `tests/internal.routes.test.ts`'s own pre-existing
  fixture in the same real database - moved to `850`.
- Full regression: monolith 520/520 (unchanged), `candidate-core-service` 18/18, `api-gateway`
  67/67, `tsc --noEmit` clean across all three, `docker compose config` clean.

## 6x. Major cross-cutting finding: `DUAL_WRITE_ENABLED` had been off for the entire migration

Discovered while doing real Docker verification of §6w's cutover: created a real candidate through
the new `POST /api/candidates` path, then checked `candidate-core-service`'s own database directly
- the row was there (write succeeded, monolith stayed authoritative, exactly as designed), but its
mirror was still completely EMPTY. Not a bug in this batch's own code - `src/dualWrite.ts` (built
across many earlier batches, structurally safe by its own stated hard rules: never blocks, never
throws, disabled by default via `DUAL_WRITE_ENABLED === 'true'`) had simply never had that flag
turned on. Every dual-write mirror built across this entire migration - not just Candidate Core
Service - has been running on whatever its own one-time backfill last captured, silently falling
further behind the monolith's real writes ever since, with zero indication anything was wrong
(each mirror's own health check only ever does `SELECT 1`).

- **Enabled `DUAL_WRITE_ENABLED=true` in `.env.local`.** Safe by the module's own structural
  guarantees (fire-and-forget, internal try/catch, never affects the monolith's real write path) -
  confirmed by re-running the full monolith regression (520/520, unaffected) after enabling it.
- **Audited every service with a `validate-*-sync.ts` script for real drift** (15 services). Found
  real, meaningful staleness in `identity-service` (candidate_accounts 32/37),
  **`candidate-service` (candidate_accounts/candidate_experiences/candidate_notifications all
  completely EMPTY - 0 rows - despite being an already-gateway-routed, real-traffic surface)**,
  **`chat-service` (knowledge_base_chunks - 0 of 53 real chunks - meaning RAG/chatbot semantic
  search had zero real data to search over)**, `recruiting-service` (recruiter_notifications, 0 of
  6), plus every not-yet-gateway-routed service (`job-service`, `career-intelligence-service`,
  `dynamic-weighting-service`, `matching-decision-service`, `matching-reasoning-service`,
  `role-intelligence-service` - all had never been backfilled at all, 0 rows across the board).
  Re-ran every affected service's own `backfill-*.ts` script for real; re-validated afterward -
  every one now reports exact sync (except `matching-evaluation-service`'s/`matching-skill-
  discovery-service`'s `skill_nodes`/`role_profiles`, which show the TARGET with MORE rows than the
  monolith - expected, not a bug: skill discovery's whole function is creating new canonical skill
  nodes independently, a legitimate second writer for that one table).
- **Real consequence if this had gone unnoticed**: `candidate-service`'s empty mirror means every
  read through its already-live `/api/candidate-profile`, `/api/candidate-jobs`, etc. surfaces has
  potentially been serving from a stale/empty dataset since whenever its own last backfill ran, not
  the "real, live-synced" data every prior batch's own documentation claimed. This was caught by
  doing genuine end-to-end verification (checking the actual mirrored row after a real write, not
  just checking the HTTP response code), not by code review - the code itself was already correct;
  the *operational state* it depended on silently wasn't.

## 6y. Remaining-monolith migration, Step 3c - candidate-analytics folded into Candidate Service

`GET /api/candidate-analytics` gateway-routed to `candidate-service`, not `analytics-service` -
confirmed via inspection (not assumption) that this route is gated by `requireCandidateAuth`
(candidate self-service JWT, `candidate_accounts`), the exact same auth model
`candidate-service` already uses everywhere else; `analytics-service`'s own auth is
staff/recruiter-only and has never had a candidate-auth concept. Same "extend an existing
service's scope" precedent as `candidate-service`'s own `candidate_notifications` fold-in.

- **Proxy, not a cutover** - the aggregation reads jobs, recruiter review/swipe data, and
  application status, none owned by any single service yet (job-service/matching-decision-service
  cutovers are Steps 4/6, not done). Extracted the monolith's existing handler body into an
  exported `computeCandidateAnalytics(candidateId)` (`src/api/candidate-analytics.routes.ts`) so
  both the original public route (now dead-but-mounted, matching every other cutover route in this
  migration) and a new internal endpoint (`GET /internal/candidate/analytics`,
  `src/api/candidate-internal.routes.ts`) call the identical, unmodified computation - zero logic
  duplicated, zero behavior change.
- New `candidate-service/src/routes/candidateAnalytics.routes.ts` + one new function on its
  already-existing `services/monolithClient.ts` (this service already proxies several other
  monolith-owned reads - job discovery, decisions, applications, matches - so this fits its
  established shape exactly, no new client needed).
- **Pre-existing gap found and fixed**: `candidate-service` had no `.env.local` of its own at all -
  `npm test` had apparently never been run in isolation for this service before (its own tests
  presumably only ever ran as part of a broader Docker-based check). Created one, matching every
  other service's convention - deliberately did NOT add a real `JWT_SECRET` to it (unlike
  `candidate-core-service`'s/`matching-scoring-service`'s own `.env.local` in Steps 1/3a) because
  this service's *existing* 29 tests all sign against the default dev secret; adding a real one
  would have silently broken them by making the config's own `JWT_SECRET` constant diverge from
  what the tests expect - caught by running the existing suite before writing any new tests, not
  after.
- Tests: 3 new in the existing `tests/proxyRoutes.test.ts` (proxy success, 401 gating, 404
  passthrough) - full file now 32/32. Monolith: 520/520 unaffected (only the extraction/wiring in
  `candidate-analytics.routes.ts`/`candidate-internal.routes.ts`, no behavior change).
- Full regression: `candidate-service` 32/32, `api-gateway` 66/66, `tsc --noEmit` clean across
  monolith/`candidate-service`/`api-gateway`, `docker compose config` clean (no new env vars
  needed - `candidate-service` was already fully wired since its own earlier batch).

## 6z. Remaining-monolith migration, Step 4 - Job Service's real cutover for `GET /jobs/:id`, proxy for the rest

`GET /api/jobs/:id` gateway-routed to `job-service` for the first time as a genuine real cutover -
not a proxy, and not a plain read of its own dual-written mirror either: it fuses three sources -
this service's own DB row, `candidate-core-service`'s bounded candidate pool (new endpoint, see
below), and `matching-scoring-service`'s real ranking (Step 2's now-complete callable surface) -
into the single scored, matched-candidates response the frontend's job-detail view needs. `GET
/api/jobs`, `POST /api/jobs`, `PUT /api/jobs/:id`, `DELETE /api/jobs/:id` also gateway-routed here,
but proxy straight through to the monolith - the monolith stays the sole writer for the same
reason as `candidate-core-service`'s writes in §6w: `swipe.routes.ts`, `recruiter-review.routes.ts`,
and `candidate-search.routes.ts` (Steps 5-6, not done) still read `jobs` directly from the
monolith's own database and would see stale data the moment writes stopped landing there.

- **Why `GET /jobs/:id` specifically was ready now and nothing else was**: it's the one job route
  whose real complexity (candidate-pool retrieval + live scoring) was fully unblocked by Steps 1-2's
  `matching-scoring-service` work; the other four either need cross-service swipe-count aggregation
  not yet available (list) or must stay monolith-authoritative for the write-ordering reason above.
- Monolith side: extracted `job.routes.ts`'s existing `GET /jobs` and `POST`/`PUT /jobs/:id` bodies
  into three exported, reusable functions (`getEnrichedJobsList`, `createJobWithSideEffects`,
  `updateJobWithSideEffects` - zero behavior change, same "move the edge first" extraction shape as
  every prior step) so the new `src/api/job-internal.routes.ts` can call the exact same logic the
  public routes always have. `DELETE /jobs/:id` needed no extraction (already two lines).
- New `candidate-core-service` endpoint, `GET /internal/candidates/for-job-scoring` - a bounded,
  recall-first pre-filter (`getCandidatesForJobScoring`, ported from the monolith's own live-scoring
  candidate-pool query: skills-match-first ordering, `LIMIT 1500`) that applies `mapRowToCandidate`
  before responding, unlike the plain `/internal/candidates` list endpoint's documented raw-row
  contract - required here because `computeMatchFeatures` needs real arrays, not delimited strings
  (the same shape-mismatch class of bug §6w already found and fixed for the public routes).
- New `job-service/src/routes/jobs.routes.ts` (the flagship file) - `GET /jobs/:id` calls its own
  `db.getJobById`, then `candidateCoreServiceClient.getCandidatesForJobScoring` and
  `matchingScoringServiceClient.rankCandidatesForJob` (tier: `'full'`, `persist: { companyId,
  source: 'job_detail' }` so ranked rows land for real, not just returned in-memory). The other four
  routes proxy through a new `monolithClient.ts` to the monolith's new `/internal/job/*` surface.
  First service in this migration calling three different upstreams from one route - `utils/
  metrics.ts` uses `upstreamProxyCount`/`upstreamProxyDuration` with both `upstream` and `target`
  labels instead of the usual single-upstream pattern, to keep each hop's latency/outcome distinct.
- **Pre-existing helm gap found and fixed, unrelated to this step's own code**: `api-gateway`'s helm
  chart (`helm/api-gateway/values.yaml`) was missing `MATCHING_SCORING_SERVICE_URL` and
  `CANDIDATE_CORE_SERVICE_URL` entirely - a real production Helm deployment would have hit
  `config/env.ts`'s fail-fast `process.exit(1)` at startup ever since Steps 1/3a, never caught
  because `docker-compose.yml`/local verification don't exercise the Helm path. Added those two plus
  the new `JOB_SERVICE_URL`, all three now `helm lint`-clean.
- Real Docker verification (not simulated): rebuilt `app`, `job-service`, `api-gateway` with
  `--no-cache`, brought up, restarted nginx. First real end-to-end `GET /api/jobs/22` attempt
  returned a 502 - root-caused via `job-service`'s and `candidate-core-service`'s real container
  logs to `candidate-core-service` still running a stale image built before its own
  `for-job-scoring` endpoint existed (that endpoint was only ever verified by local `vitest`/`tsc`
  in this step, never rebuilt into a running container) - rebuilt and redeployed
  `candidate-core-service` too, which resolved it. After that: a real signed staff JWT against real
  seeded data (`company_id: 1`, job `id: 22`, "Generative AI Developer") returned 32 real
  `matched_candidates` with real per-candidate `breakdown` (skills/experience/location/salary/
  similarity/ensemble sub-scores); confirmed real rows landed in `matching-scoring-service`'s own
  `match_scores` table at the exact request timestamp (not fabricated); confirmed via `docker
  compose logs app` that **zero** monolith requests occurred for this path during the test - the
  actual proof of the cutover. Also exercised the full write-proxy path for real: created job `id:
  211` via `POST /api/jobs`, confirmed the real cutover's `GET /api/jobs/211` immediately saw it
  (dual-write mirror freshness confirmed), updated it via `PUT`, deleted it via `DELETE`, confirmed
  a subsequent `GET` correctly 404s. `GET /health` confirms all 13 upstreams `ok`, including
  `job-service`.
- Tests: `job-service` 19/19 (8 pre-existing + 11 new - auth gating, list/create/update/delete
  proxy pass-through, the flagship fusion test asserting zero monolith calls for job-detail plus the
  exact query string/body sent to each of the two other services, 404-for-wrong-company, 502 on
  either upstream's failure), `candidate-core-service` 21/21 (10 pre-existing + 1 new for
  `for-job-scoring`), `api-gateway` 72/72 (5 new routing tests + 2 corrected assertions that
  previously asserted `/api/jobs/123` stayed on the monolith, no longer true). Monolith: 520/520
  unaffected (extraction only, no behavior change).
- Full regression: `tsc --noEmit` clean across monolith/`job-service`/`candidate-core-service`/
  `api-gateway`, `docker compose config --quiet` clean, `helm lint` clean for both `job-service` and
  `api-gateway`.

## 6aa. Remaining-monolith migration, Step 5 - candidate-search.routes.ts folds into Candidate Service, NOT Candidate Core Service

`GET /api/candidate-search`, its four `tab/*` sub-routes, save/unsave, and profile-view all
gateway-routed to `candidate-service` for the first time - real cutovers for everything except
`tab/shortlisted`, which proxies to a new monolith internal endpoint.

- **The plan document's assignment was wrong, and real inspection (not the plan) is what caught
  it** - the original plan listed this route file's destination as `candidate-core-service` ("same
  bounded context" as its recruiter-facing candidate database). Reading the actual queries in
  `candidate-search.routes.ts` shows it reads/writes `candidate_accounts` - a table
  `candidate-service` has owned outright, real reads AND writes, since Batch 16 - a completely
  different table from `candidate-core-service`'s own `candidates` (recruiter-uploaded resumes,
  Step 3a). This is the same class of correction §6y made for `candidate-analytics.routes.ts`
  (auth model, not a table check, caught that one) - the lesson holding across both: verify the
  plan's per-file destination against the file's own real dependencies before implementing, every
  time, even when the plan sounds reasonable on its face.
- **Real cutover, not a mirror-then-cutover** - unlike every other Tier 0 service extraction in
  this migration, `candidate-service` already had direct, authoritative read/write ownership of
  `candidate_accounts` (Batch 16 built it that way from the start, no dual-write mirror involved).
  So this step needed no backfill/validate scripts for that table - only for the two BRAND NEW
  tables candidate-search itself owns (see below).
- **Two new tables, genuinely new ownership, not a migrated mirror** -
  `saved_candidates`/`candidate_profile_views` (recruiter-personal saved list / profile-view
  history) previously lived only in the monolith's schema, read/written exclusively by
  `candidate-search.routes.ts` itself. `candidate-service/migrations/003_candidate_search.up.sql`
  creates both fresh, FK-eliminated the same way `candidate_notifications` was (§6b-i) -
  `recruiter_user_id`/`company_id` stay plain scoping columns (identity-service/tenant-directory-
  service own those tables, not this service), `candidate_account_id` keeps a real FK since
  `candidate_accounts` lives in this same database. One-time backfill (not an ongoing dual-write
  hook, since this service becomes sole owner from here forward): 0 `saved_candidates` rows, 1
  `candidate_profile_views` row, both confirmed via direct inspection before writing the migration.
- **A third cross-service dependency this route never had before**: `last_active` enrichment reads
  `candidate_refresh_tokens`, which is identity-service's own domain (candidate auth sessions), not
  candidate-service's. New `GET /internal/candidates/last-active` (bulk, network-boundary-trusted,
  no JWT) added to identity-service - the first time this migration has needed a THIRD service's
  new endpoint just to support a SECOND service's own cutover. `candidate-service`'s new
  `services/identityServiceClient.ts` calls it, gracefully degrading to `null` last_active on any
  failure (a soft enrichment field, unlike matching-scoring-service's ranking call below - a
  deliberately different failure posture within the same route, not an oversight).
- **Query-based ranking reuses Step 2's callable surface, tier: 'heuristic'** - identical to what
  this route always computed inline (`computeMatchFeatures`/`computeFeatureScore` only, no ML
  ensemble, no embeddings, no persistence - `matching-scoring-service`'s own `rankCandidatesForJob`
  short-circuits before any of that when `tier === 'heuristic'`). The two synthetic-object adapters
  (`toSyntheticCandidateFromAccount`/`toSyntheticJobFromQuery`) were ported as local, dependency-
  free pure functions directly into `candidateSearch.routes.ts` rather than calling
  matching-scoring-service's own exposed `/internal/synthetic-*` endpoints for them - a network
  round-trip for a one-line object transform isn't worth it; only the real ranking work goes over
  the wire. `matching-scoring-service`'s own doc comments (both the module header naming
  candidate-core-service as a future caller, and the synthetic-adapter comment) were stale from
  before this correction - fixed in place.
- **`tab/shortlisted` stays a proxy, not a cutover** - it joins `swipes` (matching-decision-
  service's Step 6 domain, not done) and `candidates` (candidate-core-service's own table) - a
  cross-service join no live service can perform locally yet. New monolith
  `src/api/candidate-search-internal.routes.ts` (`GET /internal/candidate-search/shortlisted`)
  wraps the existing `db.getShortlistedCandidateAccounts` unchanged, returning raw
  `CandidateAccount` rows (no shaping) so `candidate-service` applies its own `toSearchResultShape`
  uniformly across every tab, real or proxied - the monolith's internal response includes
  `password_hash` (an internal, network-boundary-trusted contract, matching every other
  `/internal/*` raw-row endpoint in this codebase), confirmed stripped before ever reaching a
  client by the shaping function's explicit allow-list.
- **A structural auth-routing bug found and fixed before this could ship**: every one of
  `candidate-service`'s pre-existing routers applies a blanket, path-unscoped
  `router.use(requireCandidateAuth)` - safe until now because every router mounted at `/api` served
  the same candidate-self-service auth domain. `candidateSearch.routes.ts` is genuinely the first
  STAFF-auth router in this service; mounting it after the others meant their blanket middleware
  401'd every staff request before it ever reached its own router. Fixed by (1) scoping this
  router's own auth middleware to `/candidate-search` specifically
  (`router.use('/candidate-search', requireAuth, requireRole(...))`, not a bare `router.use()`) and
  (2) mounting `candidateSearchRoutes` FIRST in `server.ts`, ahead of every blanket-auth router -
  requests for any other path now correctly fall through via `next()` to the router that owns them.
  New `middleware/staffAuth.middleware.ts` (byte-copy of the established staff HS256 pattern,
  distinct file from the pre-existing candidate-auth `middleware/auth.middleware.ts` so both
  `req.user` and `req.candidate` augmentations coexist without collision).
- **Two pre-existing gaps found and fixed, unrelated to this step's own code**: (1) `zod` was a
  phantom dependency in `candidate-service` - `tsc`/`vitest` resolved it from the monolith's root
  `node_modules` via Node's parent-directory module resolution, silently masking that it was never
  declared in this service's own `package.json`; only surfaced when the isolated Docker build (no
  parent `node_modules` to fall back to) failed at runtime with `Cannot find module 'zod'`. Fixed
  by adding it as a real dependency. (2) `identity-service` had no `.env.local` at all (same class
  of gap §6y found for `candidate-service` itself) - `npm test` had never been run in isolation for
  this service before; created one, and cleaned up one orphaned test fixture row (a stray
  `candidate_accounts` row from 2026-07-31, predating this session, left behind by an interrupted
  earlier test run) discovered in the process.
- **Real Docker verification (not simulated), including a real production-shaped failure caught
  and fixed**: rebuilt `app`, `identity-service`, `candidate-service`, `api-gateway` with
  `--no-cache`. The FIRST rebuild attempt of this batch silently failed for `candidate-service`
  (and left `app`'s build canceled) after a ~69-minute `npm install` hang - the background task's
  own completion notification incorrectly reported exit code 0, masking the failure; caught only by
  noticing `grep -c 'candidate-search' /app/dist/server.cjs` returned 0 in the "successfully"
  redeployed container. Retried the build for each affected service individually and confirmed
  each one actually succeeded before redeploying - the zod gap above surfaced during this retry.
  After a clean redeploy + nginx restart: a real signed staff JWT (`user_id`, not `userId` - a
  second manual-token mistake caught the same way, via a real 500 on `saved_candidates.recruiter_
  user_id` violating its NOT NULL constraint) against real seeded data returned real search
  results (`last_active` populated from a real identity-service call), real save/unsave
  round-tripped through `tab/saved`, a real profile view surfaced in `tab/recently-viewed`, and
  `tab/shortlisted` returned 9 real shortlisted candidates via the monolith proxy, correctly shaped
  with no `password_hash` leak. Confirmed via `docker compose logs app` that every real-cutover
  endpoint produces zero monolith traffic, while `tab/shortlisted` is the only one that does.
  `GET /health` confirms all 13 upstreams `ok`.
- Tests: `candidate-service` 42/42 (32 pre-existing + 10 new - auth gating including a 401 for a
  candidate-scheme token entirely, unranked vs. ranked search, save/tab/saved/unsave round-trip,
  profile-view/recently-viewed, the shortlisted proxy including its own 502-on-upstream-failure
  case), `identity-service` 128/128 (125 pre-existing + 3 new for the bulk last-active endpoint),
  `api-gateway` 75/75 (3 new routing tests + 1 corrected assertion that previously asserted
  `/api/candidate-search` stayed on the monolith, no longer true), monolith 523/523 (520 + 3 new
  for the internal shortlisted endpoint, extraction-free - no existing behavior changed).
- Full regression: `tsc --noEmit` clean across monolith/`candidate-service`/`identity-service`/
  `api-gateway`, `docker compose config --quiet` clean, `helm lint` clean for `candidate-service`
  (also closed a pre-existing gap while there: `api-gateway`'s own helm chart was separately found
  missing `MATCHING_SCORING_SERVICE_URL`/`CANDIDATE_CORE_SERVICE_URL` in §6z - unrelated to this
  step's own scope, already documented there).

## 6bb. Remaining-monolith migration, Step 6 (final step) - Matching Decision Service's real cutover for queue/score/history/stats, proxy for swipe-record and all of Recruiter Review

`GET /api/matches/queue/:job_id`, `POST /api/matches/score`, `GET /api/swipes/history`, and
`GET /api/swipes/stats` gateway-routed to `matching-decision-service` for the first time - real
cutovers, this service's first-ever public HTTP surface (previously a mirror-only, zero-traffic
Tier 0 service). `POST /api/swipes` and all five `/api/recruiter-review*` routes also
gateway-routed here, but proxy through to the monolith - the monolith stays the sole writer/
compute owner for reasons specific to each, detailed below.

- **The real-vs-proxy split required a harder, more architecturally fundamental analysis than any
  prior step** - not "is the data owned yet" (Steps 3a/4/5's question) but "can the query even be
  answered anymore, now that database-per-service is real." `recruiter-review.routes.ts`'s own
  list endpoint does a single SQL query joining `swipes`, `candidates`, `jobs`, `users`, and
  `recruiter_notes` - five tables that, as of this migration, live in FOUR separate physical
  databases (matching-decision-service, candidate-core-service, job-service, identity-service).
  Filtering/sorting/search operate on the joined columns (candidate name/skills ILIKE, job title,
  etc.), which cannot be pushed down across a database boundary - a "real cutover" would mean
  fetching every candidate/job up front and filtering in memory, silently breaking the query's own
  SQL-level pagination and correctness for any company with a non-trivial candidate/job count. This
  is a genuine, structural limit of the strangler-fig approach, not a scope shortcut - confirmed by
  reading the actual query (`src/db.ts`'s `getRecruiterReviewList`), not assumed.
- **`swipe.routes.ts` split along a different axis: side effects, not joins.** `GET /matches/queue/
  :job_id` and `POST /matches/score` are pure fan-out-and-compute (job + candidates + ranking, no
  writes, no realtime, no queue) - the exact same shape job-service's own `GET /jobs/:id`
  introduced in Step 4, so they became real cutovers. `POST /swipes` looks similar on the surface
  but actually writes `swipes` AND fires three monolith-only side effects: real-time broadcast
  (`src/realtime.ts`, WebSocket connections held by the monolith process), the BullMQ retrain
  queue (`src/queue/retrainQueue.ts`), and shadow-mode proficiency-weighting logging - none
  portable to a new service in one step, so it stays proxied, keeping the monolith the sole writer
  (this service's own `swipes` mirror stays dual-write-fed, unchanged).
- **`GET /swipes/history`/`GET /swipes/stats` real cutover needed two brand-new bulk-by-id
  endpoints on OTHER services** - `job-service`'s `GET /internal/jobs/by-ids` and
  `candidate-core-service`'s `GET /internal/candidates/by-ids` (both new, ported from the
  monolith's own `getCandidatesByIds`; job-service's version deliberately has no "open-only"
  status filter, unlike its own pre-existing `getJobs`, since a swipe can reference a since-closed
  job and the point is showing its title, not filtering by current status - a minor, deliberate
  improvement over the monolith's own "Unknown Job" gap for closed jobs, not a regression).
  `candidate-core-service`'s by-ids endpoint applies `mapRowToCandidate` (real arrays), unlike its
  own plain `/candidates/:id` (raw delimited strings) - the same shape-mismatch class of bug Step
  4 already found once; avoided here by routing even single-candidate lookups through the by-ids
  endpoint (one-item array) rather than adding a second, differently-shaped single endpoint.
- **A real, subtle behavior bug caught before shipping**: `GET /swipes/history`'s extraction
  initially assumed this service's own `db.getSwipes` (ORDER BY timestamp DESC) already matched
  the monolith's final response order. It didn't - the monolith's own handler ALSO orders DESC,
  then explicitly `.reverse()`s in JS to show oldest-first. Missing that reversal would have
  silently inverted the entire history list's order for real users. Caught by re-reading the
  monolith's own `getSwipes` query text before assuming, not by testing alone.
- **A second real bug caught in the same extraction**: `PATCH /recruiter-review/:id/decision`'s
  original handler returns two DIFFERENT 404 messages for two different failure cases ("Decision
  not found" vs. "Candidate or job no longer exists") - an early version of the extraction
  collapsed both into one sentinel, silently losing the distinction. Fixed by using two distinct
  sentinel values (`'decision_not_found'` / `'candidate_or_job_not_found'`) through the extracted
  function, preserving the exact original response text for each case.
- Monolith side: extracted `swipe.routes.ts`'s `POST /swipes` body into
  `recordSwipeWithSideEffects` (one function, unchanged logic - real-time broadcast/BullMQ/shadow
  logging all still fire exactly as before) and all five `recruiter-review.routes.ts` handlers
  into their own exported functions - `getRecruiterReviewListWithStats`,
  `getRecruiterReviewDetailWithExplanation`, `upsertRecruiterNoteForSwipe`,
  `generateAndSaveDetailedScore`, `changeRecruiterReviewDecision` - same "move the edge first"
  shape as every prior step, zero behavior change (confirmed by the full 523/523 monolith
  regression staying green through the extraction). New `src/api/matching-decision-internal.
  routes.ts` wraps all six as network-boundary-trusted `/internal/matching-decision/*` endpoints.
- New `matching-decision-service/src/db.ts` additions: `getShortlistedCandidateIds` (ported
  unchanged from the monolith - a single-table query against this service's own `swipes` mirror,
  no cross-service call needed) and `getSwipeStats` (a fresh SQL aggregate query, not a JS port of
  the monolith's own `.filter()`-based version - same result, computed differently since this is a
  new implementation rather than a byte-for-byte port).
- New `matching-decision-service/src/routes/matches.routes.ts` (the four real cutovers +
  swipe-record proxy) and `recruiterReview.routes.ts` (five proxy routes, reusing the exact same
  Zod schemas the monolith's own route file defines) - this service's first-ever
  `middleware/auth.middleware.ts` (staff HS256, byte-copy pattern) and first-ever real
  `cookieParser()`/CORS-with-credentials wiring in `server.ts` (previously `cors({ origin: false
  })`, internal-only). BGE shadow retrieval comparison (`logBgeShadowComparisonInBackground`,
  fire-and-forget telemetry with zero effect on real output) is deliberately NOT replicated in the
  new `GET /matches/queue/:job_id` - documented in the route file, not silently dropped.
- **Two more phantom-dependency gaps found and fixed before the Docker build, learning directly
  from §6aa's `zod` incident** - `jsonwebtoken`/`@types/jsonwebtoken` and `zod` were both missing
  from `matching-decision-service/package.json` (resolved locally via the monolith's root
  `node_modules`, same parent-directory Node resolution quirk as before). Added both proactively,
  before the isolated Docker build had a chance to fail on them.
- **Real Docker verification (not simulated), including a repeat of §6z's "background build
  silently failed" incident - caught immediately this time**: the first `docker compose build
  --no-cache app job-service candidate-core-service matching-decision-service api-gateway`
  background run again reported a false "completed, exit code 0" notification. This time, the log
  was checked explicitly for literal `Built` lines (and `ERROR`/`failed to solve`) before trusting
  it - all five were genuinely present, so no silent-failure repeat this step. After deploy +
  nginx restart: a real signed staff JWT against real seeded data - `GET /api/swipes/stats`
  returned real aggregated numbers (44 total swipes, zero calls to job-service/candidate-core-
  service, confirmed via metrics-adjacent call counting); `GET /api/swipes/history` returned 107
  real swipes with real hydrated candidate/job names, oldest-first; a real `POST /api/swipes`
  (action: 0.5, "Saved") through the monolith proxy, immediately visible via the real-cutover
  `GET /api/matches/queue/22` (zero monolith calls for that specific read, confirmed via
  `docker compose logs app`) and a real new `match_scores` row landing in matching-scoring-
  service's own database at the exact request timestamp; `POST /api/matches/score` returned a
  real full breakdown; `GET /api/recruiter-review` (proxy) correctly showed the just-created swipe
  in its list; `GET /api/recruiter-review/134/22` (proxy) returned a real `computeMatchExplanation`
  result. `GET /health` confirms all 14 upstreams `ok`, including `matching-decision-service`.
- Tests: `matching-decision-service` 28/28 (10 pre-existing + 18 new across `matches.routes.test.
  ts` and `recruiterReview.routes.test.ts` - auth gating, all four real cutovers including the
  flagship queue-fusion test asserting zero monolith calls, the swipe-record and all five
  recruiter-review proxies including 422-before-ever-calling-the-monolith validation gating and a
  502-on-upstream-failure case, plus the same mock-prefix-collision workaround `delete
  monolith.responses[key]` §6w already established), `job-service` 23/23 (19 + 4 new for `by-ids`),
  `candidate-core-service` 25/25 (21 + 4 new for `by-ids`), `api-gateway` 82/82 (7 new routing
  tests + 2 corrected assertions - one for `/api/matches/queue|score` no longer staying on the
  monolith, one for the strangler-fig fallback test's own example path, switched to a permanent
  synthetic placeholder after needing a real-path fix twice already in this migration), monolith
  523/523 unaffected (extraction only, no behavior change; no new monolith-side test file was
  added for `matching-decision-internal.routes.ts` itself - same precedent as `job-internal.
  routes.ts` in Step 4, real Docker E2E already exercised all six of its endpoints with real data).
- Full regression: `tsc --noEmit` clean across monolith/`matching-decision-service`/`job-service`/
  `candidate-core-service`/`api-gateway`, `docker compose config --quiet` clean, `helm lint` clean
  for `matching-decision-service` and `api-gateway`.

## 6cc. Write-cutover completion, Phase A - Candidate Core Service becomes the real write-authority for `candidates`

`POST /api/candidates` and `DELETE /api/candidates/:id` are now genuine cutovers - Candidate Core
Service performs the real INSERT/DELETE against its own database (its own sequence now assigns new
candidate ids) instead of proxying to the monolith. This is the first of four phases completing
what Steps 3a/4/6 deliberately left as write proxies (see MIGRATION_RUNBOOK.md's own §7 note on
why, before this phase).

- **The core problem this phase had to solve, not just "move the INSERT"**: `recruiter-
  review.routes.ts`'s list/detail views stay monolith-local (an explicit, out-of-scope-for-this-
  plan boundary - see the plan's own Context section on why a real SQL join across `candidates`/
  `jobs`/`swipes`/`users`/`recruiter_notes` can no longer be expressed once those tables live in
  separate databases). Those views read `candidates` directly from the monolith's own table, so
  that table has to stay fresh even though it's no longer the primary writer. Solved with a
  **reverse mirror**: after Candidate Core Service's own write succeeds, it awaits (but never
  fails the response on) a new monolith endpoint that upserts the row into the monolith's own
  table by explicit id and re-fires the same background side effects the monolith's own create/
  delete always fired - the same safety bar `dualWrite.ts` already holds today, just running in
  the opposite direction for this specific table.
- New `candidate-core-service/src/services/confidenceService.ts` and `services/
  candidatePayload.ts` - `computeCandidateConfidence` ported verbatim (confirmed dependency-free:
  no DB, no network, pure function of already-parsed fields) and `candidatePayloadFromExtracted`'s
  field mapping ported from the monolith's own `candidate.routes.ts`, unchanged.
- `candidate-core-service/src/db.ts`'s new `createCandidate`/`deleteCandidate` are genuine
  INSERT/DELETE (not dual-write targets) - same storage convention the monolith's own
  `db.createCandidate` always used (skills/previous_companies/certifications as delimited
  strings, `skills_array` kept in sync as a real array projection).
- **A real bug caught and fixed during this port**: typing the literal null-byte-escape
  regex the monolith's own `createCandidate` uses to strip null bytes before insert kept getting
  silently corrupted into an actual raw NUL byte in the source file itself (confirmed via `cat -A`
  showing `^@`) - not a logic bug, a tooling/encoding artifact of writing that exact escape
  sequence in this environment. Worked around with `String.fromCharCode(0)` instead of a literal
  escape sequence, avoiding the problem outright rather than fighting it a third time.
- Monolith: new `mirrorUpsertCandidate`/`mirrorDeleteCandidate` in `src/db.ts` (explicit-id
  upsert/delete, the reverse of `dualWrite.ts`'s own upsert/delete-mirror functions) and two new
  endpoints in `src/api/candidate-core-internal.routes.ts` - `POST /candidates/mirror-and-notify`
  (upserts, then fires all six background side effects: RAG indexing, embedding indexing,
  unknown-skill discovery, project intelligence, career trajectory, reasoning) and
  `POST /candidates/mirror-delete` (deletes, then `deleteReasoningConclusions` +
  `removeCandidateFromIndex`). **A shape mismatch caught before it could ship**: the row arrives in
  Candidate Core Service's own raw storage shape (skills as a delimited string), correct for the
  upsert itself, but the six background triggers expect the parsed shape (real arrays) - fixed by
  exporting the monolith's own `mapRowToCandidate` (previously module-private) and applying it
  only to the side-effect call, not the upsert.
- The OLD proxy-target endpoints (`POST /candidates`, `DELETE /candidates/:id` on
  `candidate-core-internal.routes.ts`) are now dead code, left mounted-but-unreachable per
  strangler-fig discipline - Candidate Core Service's own routes no longer call them.
- Real Docker verification: rebuilt `app` and `candidate-core-service` with `--no-cache` (this
  time explicitly grepping the build log for literal `Built` lines before trusting the background
  task's own completion notification, after §6z's/§6bb's prior incidents). A real signed staff JWT
  created a real candidate (`id: 186`) with real skills/confidence-profile data; confirmed via
  direct query that both Candidate Core Service's own database AND the monolith's mirror have the
  identical row; confirmed via `docker compose logs app` that exactly one call landed on the NEW
  `/internal/candidate-core/candidates/mirror-and-notify` endpoint (not the old, now-dead create-
  proxy path); deleted the same candidate and confirmed removal from both databases plus the real
  `mirror-delete` call. `GET /health` confirms all 14 upstreams `ok`.
- Tests: `candidate-core-service` 25/25 (rewrote the three tests that asserted the old proxy
  behavior - `POST`/`DELETE` now assert a real local write plus a mirror call, and a new "monolith
  unreachable" case asserts create still succeeds, since the mirror is best-effort, not required -
  the exact opposite of the old test's own "502 on monolith failure" expectation). New monolith-
  side `tests/candidate-core-mirror.routes.test.ts` (6/6, mount-just-the-router pattern) covering
  the reverse-mirror mechanics directly: a genuinely new id inserts, the same id a second time
  updates in place (never a duplicate), and both endpoints validate their required fields before
  writing anything. Monolith regression 529/529 (523 + 6 new, unaffected).
- Full regression: `tsc --noEmit` clean across monolith/`candidate-core-service`.

## 6dd. Write-cutover completion, Phase B - Job Service becomes the real write-authority for `jobs`

`POST /api/jobs`, `PUT /api/jobs/:id`, and `DELETE /api/jobs/:id` are now genuine cutovers - Job
Service performs the real INSERT/UPDATE/DELETE against its own database instead of proxying.
`GET /api/jobs` (list) still proxies unchanged - it needs company-wide swipe-count aggregation not
yet owned anywhere.

- **Considerably simpler port than Phase A** - `jobs` already stores `required_skills`/
  `optional_skills`/etc. as real Postgres arrays in both databases (unlike `candidates`' delimited-
  string convention), so `createJob`/`updateJob` are close to byte-for-byte ports of the monolith's
  own functions, no join/split conversion needed.
- **One genuinely new wrinkle Phase A didn't have**: the monolith's own `deleteJob` is a
  transaction across four tables (`match_scores`, `swipes`, `reasoning_conclusions`, `jobs`), not
  a single DELETE. Job Service's own `deleteJob` only removes its own `jobs` row (it doesn't own
  the other three); the new `mirrorDeleteJob` on the monolith replicates the exact same four-table
  transaction, unchanged - those tables still live in the monolith's own database (or other
  services not touched by this cutover), so the cleanup still has to happen even though Job
  Service now owns the primary delete.
- **A discovery, not a new implementation**: the background embedding-indexing side effect
  (`indexJobEmbeddingInBackground`, still monolith-local, fired from the new mirror-and-notify
  endpoint) writes its computed embeddings back via the monolith's own `db.updateJob` - which
  already unconditionally calls `dualWrite.upsertJob(row)` on every call, regardless of caller.
  This means embeddings computed by this monolith-side background job already flow back into Job
  Service's own database automatically, via infrastructure that predates this phase entirely - no
  new code was needed for that path, only confirmed real via the Docker verification below (the
  updated job's own API response already included real `description_embedding`/`skills_embedding`/
  `title_embedding` values).
- New `job-service/src/services/jobPayload.ts` - `toStringArray` and the create/update field
  mapping ported from the monolith's own `job.routes.ts`, unchanged.
- Monolith: new `mirrorUpsertJob`/`mirrorDeleteJob` in `src/db.ts` and two new endpoints in
  `src/api/job-internal.routes.ts` - `POST /jobs/mirror-and-notify` (upserts, then fires all four
  background side effects: RAG indexing, embedding indexing, unknown-skill discovery, reasoning,
  plus `broadcastEvent('job-created', ...)` only when `isCreate: true`) and
  `POST /jobs/mirror-delete` (runs the same four-table delete transaction, unchanged).
- The OLD proxy-target endpoints (`POST /jobs`, `PUT /jobs/:id`, `DELETE /jobs/:id` on
  `job-internal.routes.ts`) are now dead code, left mounted-but-unreachable - Job Service's own
  routes no longer call them. `GET /jobs` (list) is unaffected, still actively used.
- Real Docker verification: rebuilt `app` and `job-service` with `--no-cache` (explicitly
  grepping the build log for literal `Built` lines before trusting the notification, consistent
  with every prior step since the incidents in §6z/§6bb/§6cc). A real signed staff JWT created a
  real job (`id: 33`); confirmed identical rows in both Job Service's own database and the
  monolith's mirror; confirmed via `docker compose logs app` the mirror-and-notify call landed.
  Updated the title and confirmed the change (plus the real embeddings noted above) in both
  databases; deleted the job and confirmed removal from both plus the real mirror-delete call.
  `GET /health` confirms all 14 upstreams `ok`.
- Tests: `job-service` 26/26 (rewrote the POST/PUT/DELETE describe blocks the same way Phase A's
  candidate tests were rewritten - real local write plus a mirror call, a "monolith unreachable"
  case asserting create still succeeds since the mirror is best-effort, and 404-without-calling-
  the-monolith cases for update/delete on nonexistent local rows). New monolith-side
  `tests/job-mirror.routes.test.ts` (6/6) covering the reverse-mirror mechanics directly, including
  the four-table delete transaction actually cleaning up a seeded `reasoning_conclusions` row.
  Monolith regression 535/535 (529 + 6 new, unaffected).
- Full regression: `tsc --noEmit` clean across monolith/`job-service`.

## 6ee. Write-cutover completion, Phase C - Matching Decision Service becomes the real write-authority for `swipes`

`POST /api/swipes` is now a genuine cutover - Matching Decision Service performs the real INSERT
against its own database (its own sequence now assigns new swipe ids) instead of proxying to
`recordSwipeWithSideEffects` on the monolith. `GET /api/matches/queue/:job_id`, `POST /api/matches/
score`, `GET /api/swipes/history`, and `GET /api/swipes/stats` were already real cutovers from Step
6 and are unaffected.

- **A production-blocking bug found and fixed before this could ship, the same class of risk noted
  as theoretical in Phase A's/B's own write-ups but never actually hit until now**: this service's
  own `swipes_id_seq` had silently fallen behind the table's real `MAX(id)` - 198 vs. 232, from 110
  real rows the monolith's own `dualWrite.upsertSwipe` had already dual-written with explicit ids
  (Postgres never advances a column's sequence when an explicit value is supplied on INSERT). Every
  prior write to this table came from that explicit-id dual-write path, so the drift had been
  accumulating silently since Step 6 with nothing to surface it - the very first real INSERT relying
  on this sequence's own `nextval()` would have collided with an already-existing id and failed with
  a primary key violation. Found by directly comparing sequence state to actual table state before
  writing any code that would depend on it, not via a failed test. Fixed with a new migration,
  `matching-decision-service/migrations/002_resync_sequences.up.sql` (`setval` to
  `GREATEST(MAX(id), 1)`); `recruiter_notes`/`detailed_scoring_reports` were resynced too,
  defensively, ahead of Phase D's own write cutover - neither had drifted as far, but the identical
  structural risk applies to both for the identical reason. Candidate Core Service's and Job
  Service's own sequences were checked too, during Phases A/B - confirmed already safe, so this bug
  is specific to `swipes`' higher write volume via the swipe-queue flow, not a pattern that recurred
  at every phase.
- `matching-decision-service/src/db.ts`'s new `recordSwipe` is a genuine INSERT (not a dual-write
  target) - ported unchanged from the monolith's own `db.ts`'s `recordSwipe`, minus the two hook
  calls it fires (those still only exist monolith-side - see below).
- `matching-decision-service/src/routes/matches.routes.ts`'s `POST /swipes` now resolves job/
  candidate via the same `jobServiceClient`/`candidateCoreServiceClient` clients Step 6 already
  built for the queue/score routes, scores via `matchingScoringServiceClient.scoreCandidateForJob`,
  writes locally via `db.recordSwipe`, awaits (but never fails the response on)
  `monolithClient.mirrorAndNotifySwipe`, then computes `next_candidate` by reusing the exact
  shortlist-ranking logic `GET /matches/queue/:job_id` already had.
- Monolith: new `mirrorUpsertSwipe` in `src/db.ts` (explicit-id upsert, the reverse of
  `dualWrite.ts`'s own `upsertSwipe`) and a new `POST /swipes/mirror-and-notify` endpoint in
  `src/api/matching-decision-internal.routes.ts` that upserts the row, then re-fires the full
  original hook bundle against it: the mutual-match check (`getLinkedCandidateAccountId` +
  `evaluateAndCreateMutualMatch`, only on Accept) and `syncApplicationStatusFromRecruiterDecision`
  (both previously only reachable from `db.recordSwipe` itself), plus shadow proficiency logging,
  `broadcastEvent('swipe-completed', ...)`, and `enqueueRetrain()` (previously only reachable from
  `recordSwipeWithSideEffects`). Fetches the candidate/job rows itself (needed for the shadow log
  and the broadcast payload's candidate name) rather than trusting anything beyond ids from the
  mirrored row.
- **A real constraint discovered, not a gap**: `swipes.candidate_id`/`job_id` are enforced foreign
  keys against the monolith's own `candidates`/`jobs` tables - unlike `mirrorUpsertJob`/
  `mirrorUpsertCandidate`, which mirror into tables with no such constraint, a swipe mirror
  genuinely fails (500, not silently) if the referenced candidate/job's own Phase A/B mirror hasn't
  landed here yet. This is fine, not a regression to fix: the calling route always resolves job/
  candidate via Job Service's/Candidate Core Service's own real databases before recording a swipe
  in the first place, so they exist by construction; `monolithClient.mirrorAndNotifySwipe` already
  treats this endpoint's failure as non-fatal on the calling side (logs a warning, moves on) -
  only this one row's monolith-local mirror is affected, never the swipe the recruiter actually
  recorded. Covered directly in the new monolith-side test (see below).
- The OLD proxy-target endpoint (`POST /swipes` on `matching-decision-internal.routes.ts`, wrapping
  `recordSwipeWithSideEffects`) is now dead code, removed outright (not left mounted-but-unreachable
  like Phases A/B's dead endpoints, since nothing else in the monolith called it either).
- Real Docker verification: rebuilt `app` and `matching-decision-service` with `--no-cache`
  (grepped the build log for literal `Built` lines before trusting the notification, per every
  prior phase's own discipline). A real signed staff JWT recorded a real swipe (`id: 239`) for a
  real seeded job/candidate pair; confirmed identical rows in both Matching Decision Service's own
  database and the monolith's mirror; confirmed via `docker compose logs app` the mirror-and-notify
  call landed (`200`, ~99ms) and `enqueueRetrain()` fired its documented fail-open log line (no
  Redis in this deployment); confirmed no error-level log lines from the mutual-match check or the
  application-status sync, meaning both ran to completion silently. Deleted the verification row
  from both databases afterward (swipes are append-only - no delete cutover exists or was needed
  here). `GET /health` confirms all 14 upstreams `ok`.
- Tests: `matching-decision-service` 30/30 (rewrote the `POST /swipes` describe block the same way
  Phases A/B rewrote theirs - real local write plus a mirror call, and a "monolith unreachable" case
  asserting the swipe still succeeds since the mirror is best-effort). New monolith-side `tests/
  matching-decision-mirror.routes.test.ts` (4/4) covering the reverse-mirror mechanics directly,
  including the FK-violation discovery above as an explicit, intentional test case rather than an
  ignored edge case. Monolith regression 539/539 (535 + 4 new, unaffected).
- Full regression: `tsc --noEmit` clean across monolith/`matching-decision-service`.

## 6ff. Write-cutover completion, Phase D (final phase) - Matching Decision Service becomes the real write-authority for `recruiter_notes` and `detailed_scoring_reports`, plus decision-change

`POST /api/recruiter-review/:id/notes`, `PATCH /api/recruiter-review/:id/decision`, and `POST
/api/recruiter-review/:candidateId/:jobId/detailed-score` are now genuine cutovers - Matching
Decision Service performs the real write against its own database instead of proxying to the
monolith. `GET /api/recruiter-review` (list) and `GET /api/recruiter-review/:candidateId/:jobId`
(detail) stay proxied, unchanged - the explicit, structural scope boundary this whole plan was
built around (see the plan's own Context section: a 5-table SQL join across now-separate
databases can't be expressed as one query anymore). This completes the write-cutover completion
plan (Phases A-D) and, with it, every step of both the original six-step remaining-monolith
migration and this follow-on plan.

- **Decision-change reuses Phase C's own machinery almost entirely** - the monolith's own
  `changeRecruiterReviewDecision` already called the identical `db.recordSwipe` (a decision change
  IS a new swipe row, by design, to preserve full audit history), so `PATCH /recruiter-review/:id/
  decision` calls the exact same `db.recordSwipe` and `monolithClient.mirrorAndNotifySwipe` Phase C
  already built - no new write path, just a new caller. The only real new work was teaching the
  shared `POST /swipes/mirror-and-notify` endpoint to tell the two flows apart: a new optional
  `source: 'decision-change'` field, set only by this route, makes the monolith endpoint broadcast
  `'recruiter-review-decision-changed'` instead of `'swipe-completed'` and skip `enqueueRetrain()` -
  matching `changeRecruiterReviewDecision`'s own original behavior exactly (it never called
  `enqueueRetrain`; only `recordSwipeWithSideEffects`, `POST /swipes`'s own flow, did). Verified
  live: the monolith's own log showed the mirror call landing with no `Redis unavailable` line for
  this swipe specifically, confirming the retrain skip actually took effect, not just compiled.
- **Notes and detailed-score are the simplest cutovers in the entire plan** - genuine upserts on
  each table's own real `(company_id, candidate_id, job_id)` unique constraint (not append-only
  like `swipes`), no side-effect hook bundle to re-fire at all beyond the reverse-mirror upsert
  itself (the monolith's own `upsertRecruiterNoteForSwipe`/`generateAndSaveDetailedScore` never had
  background side effects beyond the write itself and, for detailed-score, the Gemini call - which
  Matching Decision Service now makes directly, not the monolith).
- **`rubric-scoring.service.ts` ported wholesale** into `matching-decision-service/src/
  rubric-scoring.service.ts` - the ~180-line system prompt, response schema, and prompt-builder are
  unchanged; only the Gemini client construction changed, from the monolith's own lazy
  `getClient()` (checks `GEMINI_API_KEY` on first use) to this codebase's established eager
  pattern (built once at module scope from `config/env.ts`, which now fail-fast validates
  `GEMINI_API_KEY` at startup - same posture chat-service already holds).
- **A real, non-obvious type gap found before it could ship**: `rubric-scoring.service.ts`'s own
  prompt builder reads `candidate.current_company`/`highest_qualification`/`university`/
  `projects`/`technical_tools`/`resume_summary` - none of which existed on Matching Decision
  Service's own (matching-focused, deliberately leaner) `Candidate` type. Investigated whether
  candidate-core-service's `/internal/candidates/by-ids` response actually carries this data:
  confirmed it does (`mapRowToCandidate` spreads the full row) - the service's own TypeScript type
  was just narrower than the real wire shape. Fixed by extending `types.ts`'s `Candidate` interface
  with these fields as optional, rather than adding a new fetch or a parallel type - no client
  changes needed.
- **`@google/genai` added as a new dependency** (`^1.29.0`, matching chat-service's own pinned
  version) - `GEMINI_API_KEY` needed no new docker-compose.yml wiring at all: every service already
  gets it for free via the existing `env_file: .env.local` passthrough pattern (§/DEPLOYMENT.md);
  only `matching-decision-service/.env.local` (local, gitignored, outside Docker) needed the real
  key added directly, for `npm test`/`tsc` to run locally - the same gap already existed
  pre-existing in chat-service's own `.env.local` (confirmed by reproducing the identical
  fail-fast startup error there), not something this phase introduced.
- Monolith: new `mirrorUpsertRecruiterNote`/`mirrorUpsertDetailedScoringReport` in `src/db.ts`
  (explicit-id upserts, same shape as every other reverse-mirror function) and two new endpoints in
  `src/api/matching-decision-internal.routes.ts` - `POST /recruiter-review/notes/mirror-and-notify`
  and `POST /recruiter-review/detailed-score/mirror-and-notify`, both upsert-only, no hooks.
  `POST /swipes/mirror-and-notify` (Phase C) extended in place with the `source` branch described
  above, rather than adding a parallel endpoint.
- The three OLD proxy-target endpoints (`POST /recruiter-review/:id/notes`,
  `POST /recruiter-review/:candidateId/:jobId/detailed-score`, `PATCH /recruiter-review/:id/
  decision` on `matching-decision-internal.routes.ts`) are now dead code, removed outright - same
  as Phase C's swipe proxy-target, since nothing else in the monolith called them either. The
  underlying functions they wrapped (`upsertRecruiterNoteForSwipe`, `generateAndSaveDetailedScore`,
  `changeRecruiterReviewDecision`) are NOT dead - `recruiter-review.routes.ts`'s own direct
  `/api/recruiter-review/*` routes still use them, just unreachable via the real nginx path now
  that the gateway routes that traffic to Matching Decision Service instead.
- Real Docker verification: rebuilt `app` and `matching-decision-service` with `--no-cache`
  (grepped the build log for literal `Built` lines before trusting the notification, per every
  prior phase's own discipline). A real signed staff JWT: posted a real note (`id: 13`) on a real
  seeded swipe/candidate/job; generated a real detailed score report via a genuine, un-mocked
  Gemini call (`id: 10`, a real, coherent rubric response scoring a .NET engineer against a PowerBI
  Developer JD - correctly flagged as a poor fit, 32.5%); changed a real decision (`id: 248`, a
  brand-new swipe row, not an update of the original) with a fresh score from a live
  matching-scoring-service call. Confirmed identical rows in both Matching Decision Service's own
  database and the monolith's mirror for all three; confirmed via `docker compose logs app` all
  three mirror calls landed (`200`) and, specifically, that the decision-change swipe's mirror call
  logged no `Redis unavailable` line (confirming the retrain skip actually fired). Deleted all
  three verification rows from both databases afterward. `GET /health` confirms all 14 upstreams
  `ok`.
- Tests: `matching-decision-service` 34/34 (rewrote `recruiterReview.routes.test.ts`'s three write
  describe blocks for real local writes plus mirror calls, mocking `@google/genai` with a
  deterministic fake `RubricReport` response rather than calling Gemini for real in CI - same
  pattern as chat-service's own tests; fixed a test-isolation bug caught immediately by the run
  itself - this file's own seed data originally reused `matches.routes.test.ts`'s exact
  `company_id`/swipe `id`, colliding under parallel file execution against the same real database;
  resolved by giving this file its own distinct `company_id`/id range, the same category of fix as
  a prior session's `candidate-core-service` test-isolation incident). New monolith-side coverage
  in `tests/matching-decision-mirror.routes.test.ts` (11/11 total, 7 new) - the two new upsert
  endpoints' mechanics, plus a case confirming `source: 'decision-change'` doesn't break the
  existing upsert. Monolith regression 546/546 (539 + 7 new, unaffected).
- Full regression: `tsc --noEmit` clean across monolith/`matching-decision-service`.

## 7. What's explicitly NOT done yet (do not assume otherwise)

- **The live-scoring engine has now been extracted, shadow-validated, AND has three real
  synchronous callers (§6t, §6v, §6z, §6aa, §6bb)** - `computeMatchFeatures`/
  `calculateMatchScoresBatch`/`calculateMatchScoresForJobsBatch` (§6t) and the full
  `matchingApi.ts`/`featureStore.ts` ranking+persistence orchestration (§6v) are ported and
  independently callable in Matching Scoring Service. `job-service`'s own `GET /api/jobs/:id`
  (§6z) and `matching-decision-service`'s own `GET /api/matches/queue/:job_id`/`POST /api/matches/
  score` (§6bb) call `rankCandidatesForJob`/`scoreCandidateForJob` at `tier: 'full'`, persisting
  real `match_scores` rows; `candidate-service`'s own `GET /api/candidate-search` (§6aa) calls the
  same entry point at `tier: 'heuristic'` (no persistence, by design). The monolith's own
  `src/matching/services.ts`/`matchingApi.ts` remain the sole computation only for
  `recruiter-review.routes.ts`'s own detail/decision-change paths now (proxied - see §6bb for why:
  `computeMatchExplanation` below, plus real-time broadcast/BullMQ, not a scoring-engine
  limitation). `confidenceService.ts` (deferred to Step 3a's host, `candidate-core-service`,
  dependency-free) and `embeddingIndex.ts` (reclassified as candidate-core-service's/job-service's
  own write-path concern, not scoring) are intentionally not part of Matching Scoring Service at
  all. `explainability/computeExplanation.ts` remains fully unextracted - real standalone
  follow-up work, tracked explicitly since §6v, still not done; `recruiter-review.routes.ts`'s own
  detail endpoint is the reason it stays proxied in §6bb, the plan's own final step. A full
  cutover decision (making the monolith itself an HTTP client of this service instead of computing
  locally) remains genuinely out of scope - not blocked on a future step anymore, since this was
  the plan's last one; it would need its own separate initiative.
- **Candidate CRUD is now real for reads AND writes (§6w, then §6cc)** - `GET /api/candidates*`
  (§6w) and `POST`/`DELETE` (§6cc, write-cutover completion Phase A) are all genuine cutovers now;
  Candidate Core Service is the real write-authority, with a reverse mirror keeping the monolith's
  own copy fresh for `recruiter-review.routes.ts`'s still-proxied reads. What stays monolith-local
  is no longer `candidates` itself, just `recruiter-review.routes.ts`'s own list/detail views (see
  below) - a real, structural reason (a cross-database JOIN that can no longer be expressed in one
  query), not an ownership gap.
- **Job CRUD is now real for reads AND create/update/delete (§6z, then §6dd)** - `GET /api/jobs/:id`
  (§6z) and `POST`/`PUT`/`DELETE` (§6dd, write-cutover completion Phase B) are all genuine cutovers;
  Job Service is the real write-authority, same reverse-mirror shape as Candidate Core Service
  above. `GET /api/jobs` (list) is the only route still proxied - it needs company-wide swipe-count
  aggregation not yet owned anywhere, unrelated to `jobs` ownership itself.
- **Candidate search is now real for search/tabs/save/profile-view, proxy-only for shortlisted
  (§6aa)** - folded into `candidate-service` (not `candidate-core-service`, the plan document's
  original guess - see §6aa for why), since `candidate_accounts` has been this service's own,
  fully-owned table since Batch 16, well before this remaining-monolith migration began. Only
  `tab/shortlisted` proxies to the monolith, because it joins `swipes` (matching-decision-
  service's own table, but the join itself still can't cross the database boundary - see §6bb's
  own structural finding) and `candidates` (candidate-core-service's own table).
- **Swipe/Match is now real for queue/score/history/stats/swipe-record, AND Recruiter Review is
  now real for notes/decision-change/detailed-score too (§6bb, then §6ee, then §6ff)** -
  `GET /api/matches/queue/:job_id`, `POST /api/matches/score`, `GET /api/swipes/history`,
  `GET /api/swipes/stats` (§6bb), `POST /api/swipes` (§6ee, write-cutover completion Phase C), and
  `POST /api/recruiter-review/:id/notes`, `PATCH /api/recruiter-review/:id/decision`,
  `POST /api/recruiter-review/:candidateId/:jobId/detailed-score` (§6ff, write-cutover completion
  Phase D) are all genuine cutovers now; Matching Decision Service is the real write-authority for
  `swipes`, `recruiter_notes`, and `detailed_scoring_reports`, with a reverse mirror re-firing the
  monolith's own real-time broadcast/BullMQ retrain queue/mutual-match/application-status-sync
  hooks against the mirrored row (swipe/decision-change only - notes/detailed-score have no hook
  bundle). Gemini-based rubric generation (`rubric-scoring.service.ts`) is ported and called
  directly from Matching Decision Service now, not the monolith. Only `GET /api/recruiter-review`
  (list) and `GET /api/recruiter-review/:candidateId/:jobId` (detail) still proxy - a cross-database
  SQL JOIN that can no longer be expressed in one query (list), and `computeMatchExplanation`,
  still fully unextracted (detail). This completes the write-cutover completion plan (Phases A-D).
- **§4 (the actual traffic flip) is now wired locally** (see §6r) but has **never been exercised
  against real production traffic** - no real AWS/EKS environment exists (confirmed: no
  `terraform.tfstate` anywhere in this repository), so everything validated this session is
  local-Docker/Compose-level, not a real production cutover.
- **API Gateway now IS the local entry point** (§6r corrects the earlier statement that nginx
  points directly at the monolith - that was true through §6q, no longer true after §6r), and its
  own routing table has grown with each step since - every Tier 0 service that had zero gateway-
  routed traffic at the start of this remaining-monolith migration (Matching Scoring Service §6u,
  Candidate Core Service §6w, Job Service §6z, Matching Decision Service §6bb) now has a real
  public HTTP front door, at least partially. Matching Reasoning Service and BGE Shadow Service
  remain the only two Tier 0 services with no user-facing HTTP surface at all - by original design
  (shadow-validation-only services with no request-time role), not a migration gap (see §6r's last
  bullet). Everything else still not explicitly routed falls through to the monolith by design.
- **None of the SHADOW_*_ENABLED / DUAL_WRITE_ENABLED flags have a real production activation
  history** - every batch's own smoke test has proven the mechanism works locally, but "proven
  locally" and "exercised under real production load" remain different claims.
- **Legacy removal** (deleting the monolith's own now-superseded routes/tables once cutover has
  been stable for a real production period) is intentionally out of scope until cutover itself has
  actually happened and proven stable - removing anything earlier would be removing the fallback
  this entire methodology exists to provide.
- **The approved remaining-monolith migration plan (Steps 1-6) is now complete** - every step
  reported back and verified with real Docker bring-up, as the plan itself committed to doing.
  This does NOT mean every monolith route is gone, or that the monolith can be decommissioned:
  - Every write path this plan touched (candidate/job/swipe create-update-delete, swipe recording,
    recruiter-review notes/decisions/detailed-score) remained monolith-authoritative by design at
    the time this plan closed, not as an oversight - see each step's own entry (§6w, §6z, §6bb) for
    the specific reason. **Superseded by the follow-on write-cutover completion plan (§6cc-§6ff)**:
    every one of those write paths is now a real cutover instead - only `recruiter-review.routes.ts`
    's own list/detail endpoints (next bullet) remain a genuine, structural exception.
  - `recruiter-review.routes.ts`'s list/detail endpoints have a real, structural reason they may
    never become a full cutover under this same strangler-fig approach - §6bb's own finding that a
    5-table SQL join can no longer be expressed once its tables live in 4 separate databases. A
    future initiative wanting to close this gap would need a genuinely different design (fan-out-
    then-hydrate-then-filter-in-memory, a dedicated read-model/search-index service, etc.), not
    just "the next step" - worth flagging explicitly so this isn't mistaken for unfinished work
    within this plan's own scope. This is the ONE piece of §7's original scope note below that the
    write-cutover completion plan did not, and structurally cannot, close.
  - `explainability/computeExplanation.ts` (deferred since §6v) remains unextracted and
    monolith-local - real, standalone follow-up work if a future initiative wants it elsewhere, not
    blocked on anything in this plan. The monolith's own direct Gemini calls
    (`rubric-scoring.service.ts`) are **no longer monolith-only** - §6ff ported the same logic into
    Matching Decision Service, which now calls Gemini directly for `POST /recruiter-review/
    :candidateId/:jobId/detailed-score`; the monolith's own copy of this file remains too, used only
    by its own now-unreachable-via-nginx direct route.
  - Every other already-documented gap above (§4 traffic flip never exercised in real production,
    no real AWS/EKS environment, `DUAL_WRITE_ENABLED`/`SHADOW_*_ENABLED` unproven under real
    production load, legacy removal out of scope) still applies exactly as stated - this plan's
    completion is a local-Docker-verified, architecturally-real milestone, not a production
    deployment claim.
