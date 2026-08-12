# TEJOMA FINAL PRODUCTION READINESS AUDIT

**Date:** 2026-08-12
**Method:** Runtime verification only — real authenticated HTTP requests through nginx, real SQL against every database, monolith physically stopped and confirmed unreachable from inside the Docker network during every monolith-off test.
**Supersedes:** the earlier same-day `TEJOMA_FINAL_PRODUCTION_MICROSERVICES_REPORT.md` (retracted — it claimed PRODUCTION READY from configuration inspection while the entire API surface was returning 502) and the first revision of this file.

---

## 1. Final Decision

# B. PRODUCTION READY WITH BLOCKERS

The complete business-critical application now runs with the monolith **completely stopped**: 20 of 21 tested endpoints return real data, and every critical write path (candidate decision, recruiter job creation, recruiter swipe, JD parsing, candidate creation) succeeds. That is a genuine change of state from the previous audit, where candidate job browsing was structurally impossible and three write paths were broken.

It is **not** A, because one authenticated surface (`POST /api/chat`) still returns 401 with a valid staff token and the cause is unresolved, and because several verification areas remain unexecuted (§9). Under the stated rule, A requires the *complete* business-critical application proven working with the monolith off; chat is part of that application and is not proven.

---

## 2. Actual Architecture (runtime-verified)

```
Browser
  → nginx :443  (TLS, serves SPA; reverse-proxies /api/* ; DNS re-resolved per request)
      → api-gateway :4000  (explicit route table; MONOLITH_FALLBACK_ENABLED=false, CANARY_PERCENTAGE=100)
          → 21 Tier-0 microservices, each with its own Postgres database
          → app :3006  (monolith — running for rollback only; serves no verified business traffic)
  Redis :6379 — pub/sub for realtime-service, BullMQ retrain queue
  Postgres 18.1 — native on the host, 22 tejoma_* databases (not containerized)
```

Only nginx (80/443), grafana (3000) and prometheus (9090) publish host ports. **`localhost` does not resolve to the Docker port forwarder on this host — `127.0.0.1` does.** All testing used `https://127.0.0.1`.

## 3. Service Inventory

29 containers: 1 monolith, 21 Tier-0 services (19 Node + 2 Python), nginx, redis, and 6 observability containers (grafana, prometheus, node-exporter, postgres-exporter, cadvisor). All healthy at audit end.

Verified internal ports (probed `/live` on the compose network): identity 4001, platform-governance 4002, tenant-directory 4003, jd-parser 4004, candidate 4005, chat 4006, recruiting 4009, analytics 4010, matching-evaluation 4011, matching-reasoning 4012, matching-skill-discovery 4013, matching-bge-shadow 4014, role-intelligence 4015, career-intelligence 4016, dynamic-weighting 4017, job 4018, candidate-core 4019, matching-decision 4020, matching-scoring 4021, realtime 4030, resume 4031.

## 4. Database Ownership Matrix

| Service | Database | Owns | Reads across boundary | Mechanism |
|---|---|---|---|---|
| candidate-service | tejoma_candidate | candidate_accounts, candidate_decisions, mutual_matches, candidate_application_status, candidate_notifications, candidate_profile_views, saved_candidates | jobs, companies | HTTP → job-service, tenant-directory-service |
| job-service | tejoma_job | jobs | candidates | HTTP → candidate-core-service |
| candidate-core-service | tejoma_candidate_core | candidates | — | — |
| matching-decision-service | tejoma_matching_decision | swipes, recruiter_review view | jobs, candidates | HTTP → job-service, candidate-core-service, matching-scoring-service |
| tenant-directory-service | tejoma_tenant_directory | companies | — | — |
| identity-service | tejoma_identity | users, refresh_tokens, candidate_accounts (auth) | — | — |
| recruiting-service | tejoma_recruiting_service | recruiter_matches, recruiter_notifications | swipes | monolithClient (unverified, §7) |
| analytics-service | — (pure aggregator) | — | swipes, jobs, candidates | HTTP fan-out |
| chat-service | tejoma_chat | messages | candidates, jobs | HTTP → candidate-core-service, job-service |
| monolith | tejoma_recruiting | legacy full schema | — | rollback only |

No inappropriate cross-service **database** writes were found; all cross-boundary reads go over HTTP.

## 5. Blockers Resolved This Session

### Blocker 1 — Candidate job browsing (RESOLVED)
Root cause was three stacked defects in job-service's already-existing `GET /internal/jobs/all`, the endpoint its own header comment reserved for "candidate-facing job browsing". **No new endpoint was invented.**
1. `/jobs/:id` was registered before `/jobs/all`, so Express matched `id="all"` → permanent 400.
2. `db.query` was absent from job-service's exported `db` object → `db.query is not a function`.
3. The query filtered `WHERE deleted_at IS NULL`, a column that has never existed on `jobs` → 500.

candidate-service was additionally calling job-service's staff-only, company-scoped `/api/jobs`, structurally wrong for cross-company candidate browsing. Rewritten onto the corrected internal endpoint with filtering/pagination applied in candidate-service.

| Test (monolith OFF) | Result |
|---|---|
| `GET /api/candidate-jobs` | 200, real jobs, company_name populated |
| `?search=DevOps` | 200, correctly filtered |
| `?location=Austin` | 200, correctly filtered |
| `?page=0&pageSize=2` | 200, correct page size |
| `GET /api/candidate-jobs/4` | 200, `company_name: "Tejoma Corp"` |
| `GET /api/candidate-jobs/99999` | 404 |

**Bonus resolved:** `company_name`/`company_logo_url` were null across every candidate endpoint (a documented gap in the prior audit). tenant-directory-service already owned companies and already exposed `GET /internal/companies/:id`; wired in via a new client and merged into job hydration. Now populated on decisions, applications, matches and jobs.

### Blocker 2 — Candidate/profile creation (RESOLVED)
Two stacked defects: `@google/genai` was imported by `utils/embeddings.ts` but never declared in `package.json`; and after fixing that, `candidates.routes.ts` called `refreshRecruiterReviewViewForCandidate` (singular) where the only export is plural and array-taking — an uncaught `ReferenceError` that turned a fire-and-forget call into a hard request failure.
`POST /api/candidates` → **500 → 201**, monolith off; row confirmed persisted by direct SQL.

### Blocker 3 — Clean build (RESOLVED — was a false positive in my own prior audit)
The previous audit reported `matching-ml-service` failing `pip install` with exit code 2. That was **my 300-second command timeout killing an ~11-minute build** (torch + CUDA wheels), not a dependency failure. A `--no-cache` rebuild completes successfully (`DONE 288.7s`, image built).

Two genuine build issues were found and characterised instead:
- A BuildKit snapshot corruption (`failed to stat active key during commit`) affecting one cached service; cleared by `--no-cache`, environmental not code.
- A `jd-nlp-service` failure that is a **PyPI read-timeout** downloading `spacy-3.8.13`, i.e. transient network, not a broken dependency spec.

### Blocker 4 — Recruiter write paths (RESOLVED)
`POST /api/jobs` failed on the same undeclared `@google/genai` (audited all 12 Node services; job-service and resume-service were the remaining offenders — resume-service matters independently as the resume-parsing path).

`POST /api/swipes` returned 404 for every swipe. Root cause was candidate-core-service's `/internal/candidates/by-ids`, which selected `first_name`, `last_name`, `experience_years` and filtered `deleted_at` — none of which exist (`name`, `years_of_experience`, no soft-delete column) — and **ignored `companyId` despite accepting it**, which would have leaked across tenants had the query run at all. matching-decision-service's `getCandidateById` is implemented as `getCandidatesByIds([id])`, so no candidate could ever resolve. Same wrong columns were repaired across `by-account-id`, `for-job-scoring` and `all`; `location` corrected to `current_location`; `JSON.parse` on the comma-separated TEXT `skills` column replaced with the service's own parse convention; and `by-ids` now maps through `mapRowToCandidate` so consumers receive `skills` as an array.

`POST /api/swipes` → **404 → 500 → 201**, `match_score: 28`, next candidate returned.
`POST /api/jobs/parse-description` → **200**, real skill extraction (Python/Django/AWS), monolith off.

### Security defect found and fixed (new this session)
`requireCandidateAuth` verified only the token signature. Identity Service signs candidate and staff tokens with the same RS256 key, so a **recruiter token passed candidate authentication**, then ran queries with `candidate_account_id = undefined` and returned `200 {"decisions":[]}` — an authorization failure rendered as "no data". No data was exposed, but the wrong principal was silently accepted. Now requires a numeric `candidate_id` claim.

| Test | Before | After |
|---|---|---|
| staff token → `/api/candidate-decisions` | 200 `{"decisions":[]}` | **401** |
| staff token → `-applications` / `-matches` / `-jobs` | 200 | **401** |
| real candidate token (regression) | 200 | **200** |

The reverse direction was already defended: candidate token on a staff route → 403 via `requireRole`.

### Write-path data defect found and fixed
`recordCandidateDecision` never persisted `company_id`, but the read path hydrates job/company display fields keyed on it. Newly recorded decisions rendered with `job_title: null` while backfilled rows displayed correctly — a candidate would swipe a job and see it blank in their own history. `company_id` is now resolved from job-service at write time; that lookup also gives a real existence check, so a decision on a nonexistent job returns 404 instead of persisting an orphan row (verified: `POST job_id=99999` → 404).

---

## 6. Final Monolith-OFF Evidence

Monolith stopped; unreachability confirmed from inside the network (`fetch failed` to `http://app:3006/health`) before every sweep.

**CANDIDATE — 8/8 PASS:** decisions, decisions/active, applications, matches, jobs, jobs/:id, analytics, notifications — all 200 with real data.
**Writes:** `POST /api/candidate-decisions` → 201, row reads back with `company_id=1`, `job_title="Data Scientist"`, `company_name="Tejoma Corp"`.

**RECRUITER — 10/10 PASS:** jobs, jobs/:id, candidates, recruiter-review, matches/queue/:id, swipes/history, swipes/stats, analytics/dashboard, analytics/skills, recruiter-notifications — all 200.
**Writes:** `POST /api/jobs` → 201; `POST /api/swipes` → 201 with real match score; `POST /api/jobs/parse-description` → 200.

**ADMIN/PLATFORM — 2/2 PASS:** `/api/users`, `/api/admin/company-requests` → 200.

**CHAT — 1 FAIL:** `POST /api/chat` → 401 with a valid staff token that job-service accepts. chat-service holds the same 450-char public key as job-service. Unresolved (§8).

**Total: 20/21 endpoints and 5/5 critical writes pass with the monolith stopped.**

## 7. Monolith Dependency Scan — Classification

24 files still reference `monolithClient`. Classification:

| Class | Files | Status |
|---|---|---|
| **E — dead code** | `candidate-service/routes/candidateAnalytics/index.routes.ts` (not mounted); `chat-service` `getPlatformStats` (misleadingly named — its body calls candidate-core-service and job-service, not the monolith) | No runtime effect |
| **B — rollback-only, fire-and-forget** | job-service mirror create/update/delete; matching-decision-service `mirrorAndNotifySwipe`; candidate-core-service mirror writes | All wrapped in internal try/catch that never throws. **Proven non-blocking:** `POST /api/jobs`, `/api/swipes`, `/api/candidates` all returned 201 with the monolith down, logging only "Failed to mirror … will be stale" |
| **B — flag-gated, real path verified** | matching-decision-service `getRecruiterReviewList` (behind `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=true`) | `/api/recruiter-review` returned real data with monolith off |
| **C/D — shadow, scoring, config, type decls** | matching-evaluation, matching-scoring, matching-skill-discovery, resume-service, `config/env.ts`, `types.ts` | Shadow-validation and config only; none on a verified business path |
| **UNVERIFIED** | `recruiting-service/routes/matches.routes.ts` (`getRecruiterMatchesFromMonolith`); `analytics-service/routes/analytics-internal.routes.ts` | Not exercised — `/api/matches` (exact) and analytics-internal were never called. **Not confirmed safe.** |

**Business-critical monolith dependencies on verified paths: 0.** Two call sites remain unclassified because the routes were not tested, not because they were shown to be safe.

## 8. Remaining Blockers

1. **`POST /api/chat` returns 401** with a valid staff token that other services accept. chat-service has the correct public key and logs no verification error. Cause unresolved. Blocks the chat workflow.
2. **`recruiting-service` `/api/matches` (exact) and `analytics-service` `/internal/analytics/*`** — both import monolith-calling functions and were never exercised. Must be tested with the monolith off before A can be claimed.
3. **`knowledge_base_chunks` table missing** in tejoma_candidate_core — RAG indexing on candidate creation logs `relation "knowledge_base_chunks" does not exist`. Non-blocking (fire-and-forget, never awaited) but means candidate RAG indexing silently does nothing.
4. **Job-service outage degrades silently** — with job-service stopped, `GET /api/candidate-jobs` returns `200 {"jobs":[]}`, so a candidate sees "no jobs exist" rather than an error. Same swallow-and-return-empty anti-pattern found repeatedly this audit; should surface 503.
5. **`jd-nlp-service` build depends on a slow PyPI fetch** that timed out once. Not a spec defect, but full-stack builds need generous timeouts and retry to be reproducible.
6. **`nanoid` high-severity advisory** (transitive, GHSA-2v37-7h3g-55p8) in candidate-core-service. Pre-existing, unaddressed.

## 9. Not Executed (BLOCKED — not passing)

- **Refresh-token rotation** — not tested.
- **Resume upload / parsing end-to-end** — resume-service's missing dependency was fixed, but the upload flow itself was never exercised.
- **Candidate login/profile-update, recruiter shortlist/reject, notifications delivery** — not exercised.
- **Idempotency and duplicate-event handling** — not tested (see §10 for what Redis testing did cover).
- **Load/performance testing, circuit breakers, secrets handling, CORS, HTTPS cert validity, deployment reproducibility beyond a single build** — not audited.

## 10. Verification Results — Areas Completed

**Redis / events — PASS.** Publish→consume confirmed (`PUBLISH tejoma-realtime` returned delivery count 1 to a live SSE subscriber). Redis restart → ioredis auto-reconnected and re-subscribed with no intervention, delivery count back to 1. Consumer restart → re-subscribed. Event published while the consumer was down → delivery count **0**, i.e. **events during a consumer outage are lost** — expected for Redis pub/sub, but it means realtime events have no durability guarantee and must not be relied on as a system of record.

**Backup / restore — PASS with evidence.** `pg_dump` of tejoma_candidate (980 lines / 48,668 bytes) restored into a disposable `tejoma_restore_test` database: 9/9 tables present, **every table's row count matched**, `candidate_decisions` 36 rows **byte-identical**, **34/34 indexes preserved**. Disposable database dropped afterwards. Note the repo's `scripts/backup-database.sh` requires `pg_dump` on the host, which is not installed — a containerised client at the matching major version (18) was required.

**Failure isolation — PASS.** chat-service stopped → `/api/chat` 502, unrelated candidate and recruiter endpoints stayed 200. analytics-service stopped → `/api/analytics/dashboard` 502, `/api/candidate-jobs` stayed 200. No cascading failure in either case. Each service restored afterwards. Dependency-chain case documented as Blocker 4.

**Security / RBAC / tenant isolation — PASS (9/9 after fix).** No token → 401. Garbage token → 401. Expired token → 401. Candidate token on staff routes → 403. Staff token on candidate routes → 401 (after this session's fix; was 200). Cross-tenant job access (company 9 → company 1's job) → 404, not leaked. Own-company access → 200. IDOR (candidate 14 requesting candidate 45's application) → 404, correctly scoped by `candidate_account_id`. Superadmin → 200.

**Data consistency — verified for the two migrated tables only.** candidate_decisions 36/36 and mutual_matches 10/10, identical ID sets, zero field mismatches, identical per-candidate distribution, `company_id` derived for 36/36. No other domain's data was compared; this is not a system-wide zero-data-loss claim.

## 11. Rollback Procedure

1. Set `MONOLITH_FALLBACK_ENABLED=true` and restart api-gateway → unmatched paths proxy to the monolith again (~2 min).
2. To roll back a specific domain, set its cutover flag to `false` (e.g. `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED`) and restart that service; the monolith-proxy branch is still present in code.
3. Full rollback: redeploy prior images and disable all cutover flags. `DUAL_WRITE_ENABLED=true` has kept the monolith's own tables current.
4. **Do not delete the monolith.** It is the rollback target and still the only source for `companies` (19 rows vs tenant-directory's 18 — a discrepancy that is itself unreconciled).

Monolith stopped and restarted cleanly four times during this audit. Config confirmed unchanged at audit end: `MONOLITH_FALLBACK_ENABLED=false`, `CANARY_PERCENTAGE=100`.

## 12. Remaining Risks

1. Every "complete" migration pass so far — including two of my own — introduced defects invisible to config/grep/build/health-check verification. **Unaudited services (resume upload flow, platform-governance, recruiting-service, notifications) should be presumed to carry equivalent-class defects** until verified the same way.
2. The recurring defect classes were: missing key on an exported `db` object (4 services), SQL referencing columns that do not exist (4 sites), undeclared npm imports (3 services), and `catch → return []` masking hard failures (5+ sites). Each is trivially greppable and worth a systematic sweep beyond the services touched here.
3. Realtime events are lossy during consumer downtime (§10).
4. `companies` data is split between the monolith (19) and tenant-directory-service (18) and is unreconciled.

---

**Commits this session:** 8 — nginx DNS fix; candidate read-path + backfill + service URLs; candidate-core `db.query`; candidate job browsing + company hydration; candidate creation; token-type-confusion security fix; decision `company_id` write path; recruiter write paths + candidate-core internal API.

**Verdict: B. PRODUCTION READY WITH BLOCKERS** — deployable behind the documented rollback, with §8 blockers tracked and §9 verification gaps closed before the monolith is decommissioned.
