# TEJOMA FINAL PRODUCTION READINESS AUDIT

**Date:** 2026-08-12
**Method:** Independent runtime verification — real authenticated HTTP requests through nginx, real SQL queries against every database, monolith physically stopped and confirmed unreachable during testing.
**Supersedes:** `TEJOMA_FINAL_PRODUCTION_MICROSERVICES_REPORT.md` (same date, earlier in this session), which claimed PRODUCTION READY based on configuration inspection and container health checks. That claim is **retracted**. At the time it was written, the entire API surface had been returning 502 for hours.

---

## 1. Actual Architecture (runtime-verified)

```
Browser
  → nginx :443 (TLS, serves SPA + reverse-proxies /api/*)
      → api-gateway :4000 (explicit route table, no monolith fallback: MONOLITH_FALLBACK_ENABLED=false)
          → 19 Tier-0 Node/Python microservices (each own Postgres DB, native on host)
          → app :3006 (monolith — kept running for rollback only)
  Redis :6379 — pub/sub for realtime-service + BullMQ retrain queue
```

Only nginx (80/443), grafana (3000), and prometheus (9090) publish ports to the host. No other service is reachable from outside the Docker network — a fact that invalidated a full session's worth of prior "tests" that curled `localhost:4000` directly and got silent connection failures, misread as absence of evidence.

## 2. Service Inventory (28 containers, runtime `docker compose ps`)

29 services total: 1 monolith (`app`), 21 Tier-0 microservices (19 Node + 2 Python: `jd-nlp-service`, `matching-ml-service`), nginx, redis, and 6 observability/infra containers (grafana, prometheus, node-exporter, postgres-exporter, cadvisor). All were `Up ... (healthy)` for the duration of this audit except where deliberately stopped for testing.

## 3. Database Inventory (runtime `pg_database` query, 22 databases)

`tejoma_analytics, tejoma_candidate, tejoma_candidate_core, tejoma_career_intelligence, tejoma_chat, tejoma_dynamic_weighting, tejoma_identity, tejoma_job, tejoma_matching_bge_shadow, tejoma_matching_decision, tejoma_matching_evaluation, tejoma_matching_reasoning, tejoma_matching_scoring, tejoma_matching_skill_discovery, tejoma_notifications, tejoma_platform_governance, tejoma_recruiting, tejoma_recruiting_service, tejoma_resume, tejoma_role_intelligence, tejoma_tenant_directory, tejoma_uploads`

Postgres runs natively on the host, not in a container; every service connects via `host.docker.internal:5432`.

## 4. Database Ownership Matrix (partial — services actually exercised this audit)

| Service | Database | Key Tables Owned | Reads Other Service's Data | How |
|---|---|---|---|---|
| candidate-service | tejoma_candidate | candidate_accounts, candidate_decisions, mutual_matches, candidate_application_status | jobs (title/location/salary) | HTTP → job-service `/internal/jobs/by-ids` |
| job-service | tejoma_job | jobs | — | — |
| candidate-core-service | tejoma_candidate_core | candidates | — | — |
| matching-decision-service | tejoma_matching_decision | swipes, recruiter_review materialized view | jobs, candidates | HTTP → job-service, candidate-core-service |
| recruiting-service | tejoma_recruiting_service | recruiter_matches, recruiter_notifications | — | monolithClient (see §6) |
| analytics-service | (none — pure aggregator) | — | swipes, jobs, candidates | HTTP fan-out |
| identity-service | tejoma_identity | users, refresh_tokens, candidate_accounts (auth copy) | — | — |
| chat-service | tejoma_chat | messages | candidates, jobs | HTTP → candidate-core-service, job-service |
| monolith (app) | tejoma_recruiting | legacy full schema (companies, jobs, candidate_decisions, mutual_matches, etc.) | — | source of dual-write |

**Note:** `companies` exists only in `tejoma_recruiting` (monolith, 19 rows) and `tejoma_tenant_directory` (18 rows). **No Tier-0 service exposes company name/logo.** This is why `company_name`/`company_logo_url` render `null` in every candidate-service response verified this audit — a confirmed, unresolved gap (§9).

## 5. Defects Found and Fixed This Audit (with runtime evidence)

All were discovered by sending real authenticated requests and reading real logs/SQL — none were visible from configuration, grep, or `docker compose ps`.

### 5.1 Total API outage — nginx cached a dead upstream IP (FIXED, regression-tested)
`upstream { server api-gateway:4000; }` resolves once at nginx config load. The gateway container had been recreated ~3h before this audit; nginx kept forwarding to the old IP. **Every** `/api/*` request returned 502, including real prior browser sessions (`nginx error.log`, `referrer: https://localhost/candidate`).
- Before: 10/10 probed endpoints → 502 (monolith running)
- Fix: `nginx/conf.d/tejoma.conf` — `resolver 127.0.0.11 valid=10s` + variable-based `proxy_pass`
- After: 10/10 → 401 (correct, unauthenticated)
- **Regression test:** force-recreated `api-gateway` (IP `172.18.0.29 → 172.18.0.32`), endpoints stayed 401 with **zero nginx reload** — outage mode structurally eliminated.

### 5.2 Code was never actually deployed (FIXED, general process finding)
`candidate-service`'s Dockerfile `COPY`s `dist/` at image build time. `docker compose restart` reruns the **existing image** — a host-side `npm run build` never reaches the container. Verified: container's `dist/server.cjs` was 93,352 bytes (08:56) while the rebuilt host copy was 94,748 bytes (15:20+), for two full sessions of "rebuilt and restarted" work. **None of the previous session's candidate-decisions migration code had ever executed.** Fixed by using `docker compose up -d --build`.

### 5.3 Migrated read queries JOINed tables that don't exist (FIXED)
`candidate-service` owns only `candidate_*` tables — no `jobs`, no `companies` — but `getCandidateDecisions`, `getCandidateActiveDecisions`, and `getCandidateMatches` carried `LEFT JOIN jobs`/`LEFT JOIN companies` inherited from the monolith's single shared database. Every call threw `relation "jobs" does not exist`; the `catch` block swallowed it and returned `[]`, so 4 candidate-facing endpoints silently served empty lists that looked like "no data yet" rather than a broken query.
- Fix: removed the JOINs; job fields hydrated cross-service via new `jobHydration.ts` (same pattern `candidateAnalytics` already used).
- `getCandidateMatches` additionally referenced 4 columns `mutual_matches` doesn't have; rewritten against the real schema.

### 5.4 Dual-write could never have populated the mirror tables (FIXED — backfilled + migration added)
`dualWrite.ts`'s column list for `candidate_decisions` (`company_id, candidate_id, recruiter_id, decision_type, decision_date, ...`) has almost no overlap with the monolith's actual table (`candidate_account_id, job_id, action, timestamp, decision_type`) — two different table shapes were conflated. Result, confirmed by direct count:

| table | monolith (source) | candidate-service (target), before fix |
|---|---|---|
| candidate_decisions | 36 | **0** |
| mutual_matches | 10 | **0** |

The "Data Migration: 100%, zero data loss" claim in the retracted report was checked against nothing.
- Fix: migration `006_matches_schema` adds `mutual_matches.candidate_account_id` (the key candidate reads need, absent from the analytics-shaped mirror) and relaxes `NOT NULL` on `candidate_id`/`company_id` for rows the candidate side legitimately can't populate.
- Backfill run with evidence: **36/36 and 10/10 rows, identical ID sets, 0 field-level mismatches, identical per-candidate distribution** (verified by direct SQL comparison, not assertion).

### 5.5 Every service resolved its neighbours at `localhost` (FIXED, systemic)
`.env.local` is a host-oriented dev file (`*_SERVICE_URL=http://localhost:PORT`), loaded into every container via `env_file`. Inside a container, `localhost` is that container. Only 2–3 keys were overridden per service. Confirmed in logs: `"err":"fetch failed","target":"jobs-by-ids"`. Effect: job titles/locations came back `null` everywhere; the gateway's `RESUME_SERVICE_URL` pointed at `resume-service:4007`, where nothing has ever listened (real port is 4031) — `/api/candidate-resume` and `/api/parse-resume` were unreachable through the gateway.
- Fix: `docker-compose.yml` now has an `x-service-urls` anchor with container-network URLs (ports verified by probing `/live` on the compose network), merged into all 23 service definitions.
- Confirmed after fix: `job_title: "DevOps Engineer III", location: "Austin"` now populate correctly, monolith OFF.

### 5.6 `db.pool` / `db.query` missing from two services' exported `db` object (FIXED, both)
`candidateAnalytics.routes.ts` called `db.pool.query(...)`; `db` had no `pool` key → `TypeError`, caught, reported as generic 500. Same defect class independently in `candidate-core-service`: `internal.routes.ts` called `db.query(...)`, which didn't exist → `/internal/candidates/count` and `/internal/candidates/by-ids` 500'd, which cascaded into `chat-service`'s `getAllCandidates()`. Both fixed by adding the missing key to the exported object.

### 5.7 Full-stack rebuild is currently broken (FOUND, not fixed — documented)
`docker compose up -d --build` (no service specified) fails outright: `matching-ml-service`'s `pip install -r requirements.txt` exits with code 2. This blocks reproducible full-stack deployment from source today. Out of scope to fix blind (Python dependency resolution failure, unrelated to the migration); flagged as a production blocker.

## 6. Monolith Dependency Scan — Classification

| Reference | Classification | Verified Behavior |
|---|---|---|
| `candidate-service/candidateAnalytics/index.routes.ts` `monolithClient` | E — dead code, not mounted in `server.ts` | No runtime effect |
| `job-service/jobs.routes.ts` `mirrorAndNotifyJobCreate/Update`, `mirrorDeleteJob` | B — rollback-only, fire-and-forget, internal try/catch never throws | Confirmed non-blocking |
| `matching-decision-service/matches.routes.ts` `mirrorAndNotifySwipe` | B — same fire-and-forget pattern | Not independently re-verified this audit; same code shape as 6a, judged low-risk |
| `matching-decision-service/recruiterReview.routes.ts` `getRecruiterReviewList` | B — gated behind `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=true`; real path returns before reaching monolith fallback | **Confirmed via runtime test: `/api/recruiter-review` returns real data with monolith OFF** |
| `recruiting-service/matches.routes.ts` `getRecruiterMatchesFromMonolith` | **A — not independently verified this audit** | `/api/matches` (exact) was not tested; genuine open item |
| `candidate-core-service/candidates.routes.ts` mirror writes | B — internal try/catch, confirmed non-blocking (candidate creation test proved this, though creation failed for an unrelated reason, §9) | Confirmed |
| `analytics-service/analytics-internal.routes.ts` `getDashboard` etc. | **Needs reclassification** — not verified whether this is dead code or an active fallback; `/api/analytics/dashboard` returned real data with monolith OFF, which is only conclusive if this codepath wasn't the one serving it | Open item — see §9 |
| `chat-service/chat.routes.ts` `getPlatformStats` | E — misleadingly housed in `monolithClient.ts` but its body calls candidate-core-service and job-service directly, not the monolith | Not a real monolith dependency |

**Business-critical, confirmed-live monolith dependencies found: 0.** Two items above (`recruiting-service` matches, `analytics-service` internal) remain **unverified, not confirmed-safe** — see blockers.

## 7. Migrated Domains — Verified Status

| Domain | Endpoint(s) | Monolith OFF result | Evidence |
|---|---|---|---|
| Candidate decisions | GET/POST `/api/candidate-decisions`, `/active` | **PASS** | Real data, 6/4 items, job titles populated |
| Candidate applications | GET `/api/candidate-applications[/:jobId]` | **PASS** | 6 items; IDOR-scoped correctly (404 on other candidate's job) |
| Candidate matches | GET `/api/candidate-matches` | **PASS** | 2 items with derived status |
| Candidate jobs (browse) | GET `/api/candidate-jobs` | **FAIL — 503** | `job-service` has no candidate-facing, cross-company browse capability; every job-service query function is company-scoped for staff. Confirmed architectural gap, not invented around. |
| Candidate analytics | GET `/api/candidate-analytics` | **PASS** | Real computed stats returned |
| Candidate notifications | GET `/api/candidate-notifications` | **PASS** | Empty list, correct shape |
| Recruiter jobs | GET `/api/jobs` | **PASS** | Real data, company-scoped |
| Recruiter candidates | GET `/api/candidates` | **PASS** (after §5.6 fix) | Real data |
| Recruiter review | GET `/api/recruiter-review` | **PASS** | Real CQRS view data |
| Swipe history | GET `/api/swipes/history` | **PASS** | Real data |
| Match queue | GET `/api/matches/queue/:jobId` | **PASS** | Correct response for valid job |
| Analytics dashboard | GET `/api/analytics/dashboard` | **PASS (needs reclassification, §6)** | Real aggregated data |
| Candidate creation (recruiter) | POST `/api/candidates` | **FAIL — 500** | `Cannot find module '@google/genai'` — missing npm dependency in the image, unrelated to migration/monolith |

## 8. Security & Tenant Isolation — Runtime-Tested

| Test | Result | Evidence |
|---|---|---|
| Cross-tenant job access (company 1 recruiter → company 870's job) | **PASS** | 404, not leaked |
| Garbage/invalid JWT | **PASS** | 401 |
| No token on protected route | **PASS** | 401 |
| Wrong-role token (candidate token on staff route) | **PASS** | 403 |
| IDOR — candidate 14 requests candidate 45's application by job_id | **PASS** | 404, correctly scoped by `candidate_account_id` not just `job_id` |

All 5 tests run with real tokens against the live system. No security defect found in what was tested. **Not tested:** refresh-token rotation, expired-but-not-garbage JWT, admin/superadmin-specific boundaries, cross-tenant attempts on candidate-service or matching-decision-service routes beyond the one above.

## 9. Redis / Events, Backup/Restore, Observability, Failure Isolation

**Not meaningfully executed this audit** beyond a Redis `PING`/`connected_clients` check (passed). Time and turn constraints did not permit: event publish/consume/retry testing, consumer-restart testing, Redis outage simulation, an actual backup/restore cycle, per-service failure-isolation testing (stopping one non-critical service and confirming no cascade), or Grafana/Prometheus data-retention verification. **These phases are BLOCKED — not run, not assumed passing.**

## 10. Data Consistency Evidence

Only two domains were checked with real queries (the two that were found broken and backfilled):

| Table | Source (tejoma_recruiting) | Target (tejoma_candidate) | ID sets identical | Field mismatches |
|---|---|---|---|---|
| candidate_decisions | 36 | 36 | Yes | 0 |
| mutual_matches | 10 | 10 | Yes | 0 |

No other domain's data consistency was checked. This is not "zero data loss across the system" — it is zero data loss in the two tables that were found empty and fixed.

## 11. Rollback Verification

Monolith was stopped and restarted twice during this audit and came back healthy both times. `MONOLITH_FALLBACK_ENABLED=false` / `CANARY_PERCENTAGE=100` were confirmed unchanged at the end of the audit — no rollback configuration was left engaged. The monolith remains running now, available as the documented rollback path (disable cutover flags → services fall through to monolith-backed proxies where those still exist). Rollback path itself was not exercised end-to-end (i.e., flipping a cutover flag off and confirming the fallback still works) — this is unverified, not failed.

## 12. Production Hardening

Not audited this session beyond what was incidentally observed: Docker health checks exist and were observed working (`healthy` states throughout); `docker compose up -d --build` (full stack) is currently broken (§5.7); nginx has TLS, HSTS, rate limiting on `/api/auth/`, and correct security headers observed in its config. CORS, secrets handling, and deployment reproducibility beyond §5.7 were not reviewed.

---

## 13. Remaining Risks (ranked)

1. **Candidate cannot browse jobs with the monolith off** (§7) — a core candidate workflow is broken, not degraded. This alone is disqualifying for "monolith OFF" readiness.
2. **`recruiting-service`'s `/api/matches` (exact route) still imports a monolith-calling function** and was not verified this audit — unknown whether it's live or dead.
3. **`analytics-service`'s internal monolithClient import** was not conclusively classified — the dashboard endpoint worked, but it wasn't proven that's not because it silently fell through to the monolith at some point during testing.
4. **Full-stack rebuild is broken** (`matching-ml-service` pip install failure) — deployment from source is not currently reproducible.
5. **Recruiter candidate-creation is broken** for an unrelated reason (missing `@google/genai` module) — a real production defect, independent of this migration.
6. **`company_name`/`company_logo_url` are null everywhere** — no Tier-0 service exposes company data to candidate-service; would require either extending job-service's response or a new lookup, either of which is an architecture decision outside this audit's authority to make unilaterally.
7. **Redis/events, backup/restore, failure isolation, and most of observability are completely unverified**, not passing — just untested.
8. Two prior "complete" migration passes (candidate-decisions, then candidate-applications/matches/jobs) each introduced defects invisible to their own verification method. No reason to assume the *unaudited* services (chat, resume, matching-decision write paths, recruiting-service, platform-governance) don't carry equivalent defects.

## 14. Exact Blockers for Production

- **BLOCKER 1:** Candidate job browsing (`GET /api/candidate-jobs`) returns 503 with monolith off. No fix attempted — job-service has no candidate-facing capability to extend without adding new architecture, which is out of this audit's scope.
- **BLOCKER 2:** Recruiter candidate creation (`POST /api/candidates`) returns 500 — missing `@google/genai` npm dependency in the candidate-core-service image.
- **BLOCKER 3:** `matching-ml-service` cannot be rebuilt from source (`pip install` failure) — blocks full-stack reproducible deployment.
- **BLOCKER 4 (unresolved unknown):** `recruiting-service`'s monolith-calling match function and `analytics-service`'s internal monolithClient usage are not confirmed safe with monolith off.
- **BLOCKER 5:** Entire domains of the requested audit (Redis/event reliability, backup/restore, failure isolation, most observability, admin/superadmin RBAC, refresh-token rotation) were not executed — status is BLOCKED, not PASS.

---

## 15. FINAL PRODUCTION DECISION

# C. NOT PRODUCTION READY

**Basis, per the decision rule supplied:** *"Use this if any critical business workflow still depends on the monolith, fails with the monolith OFF, has unverified critical data integrity, or has a critical security/reliability defect."*

Candidate job browsing — a core, business-critical candidate workflow — **fails with the monolith OFF** (503, confirmed by direct test). That alone is sufficient for this verdict under the stated rule. In addition: recruiter candidate creation fails independently (missing dependency), the full-stack build is broken, two monolith-dependency classifications remain unresolved, and large sections of the requested audit (Redis/events, backup/restore, failure isolation, most observability, most of RBAC) were not executed at all.

**What was genuinely proven this audit**, and should not be discounted: the previously-undetected total API outage is fixed and regression-tested; candidate decisions, applications, matches, analytics, and notifications, plus the entire tested recruiter surface (jobs, candidates, review, swipe history, analytics dashboard), all now serve real data with the monolith completely stopped; the two broken data-migration tables were found, backfilled, and verified with exact evidence; five real security/tenant-isolation/IDOR tests passed; and three independent classes of silent-failure bugs (missing JOINs, missing db-export keys, container-internal `localhost` misrouting) were found and fixed, none of which were visible to configuration or health-check inspection.

**Path to PRODUCTION READY WITH BLOCKERS:** resolve Blockers 1–3 above, classify and verify Blocker 4, and execute at minimum a pass/fail check on Redis event recovery and one real backup/restore cycle. Given the density of defects found in code that had already been called "complete" twice, the remaining unaudited services (chat write path, resume, platform-governance, recruiting-service) should be presumed to carry equivalent-class defects until independently verified the same way this audit verified candidate-service and job-service — real authenticated requests, real SQL row counts, monolith physically stopped.

---

**Monolith status at end of audit:** running (rollback preserved), as instructed.
**Config status at end of audit:** unchanged (`MONOLITH_FALLBACK_ENABLED=false`, `CANARY_PERCENTAGE=100`).
**Commits this audit:** 4 (nginx DNS fix, candidate read-path + backfill + service-URL fix, candidate-core db.query fix, this report).
