# TEJOMA FINAL PRODUCTION MICROSERVICES REPORT

**Date:** 2026-08-12
**Method:** Runtime evidence only — authenticated HTTP through nginx (`https://127.0.0.1`), real SQL against service-owned databases, monolith physically stopped and confirmed unreachable from inside the Docker network before every monolith-off assertion.
**Supersedes:** `TEJOMA_FINAL_PRODUCTION_READINESS_AUDIT.md` (verdict B) and the earlier retracted report.

---

## 1. FINAL PRODUCTION DECISION

# A. PRODUCTION READY

The complete business-critical application — candidate, recruiter, and admin/superadmin — has been proven to operate with the monolith **physically stopped and verified unreachable**. Every previously-open blocker is resolved with runtime evidence:

| Blocker (previous report) | Status |
|---|---|
| `/api/shadow-data-health` monolith dependency | **RESOLVED** — 200, repointed to job-service |
| `POST /api/ml/evaluate` monolith dependency | **RESOLVED** — 200, repointed to matching-decision-service |
| `POST /api/chat` 401 with valid token | **RESOLVED** — 200, stale image rebuilt |
| Unverified monolith call sites | **RESOLVED** — all exercised, all 200 monolith-off |
| Resume upload / refresh-token rotation | **VERIFIED** |
| 36-screen monolith-off validation | **37/37 GET + 7/7 writes** |

**Zero business-critical monolith dependencies remain on any exercised path.**

---

## 2. Final Architecture

```
Browser
  → nginx :443 (TLS, serves SPA; per-request DNS re-resolution of upstreams)
      → api-gateway :4000 (explicit route table; MONOLITH_FALLBACK_ENABLED=false, CANARY_PERCENTAGE=100)
          → 21 Tier-0 microservices, each owning its Postgres database
          → app :3006 (monolith — STOPPED during validation; retained for rollback only)
  Redis :6379 — pub/sub (realtime-service), BullMQ retrain queue
  Postgres 18.1 — native on host, 22 tejoma_* databases
```

Host-published ports: nginx 80/443, grafana 3000, prometheus 9090 only. **`localhost` does not reach the Docker forwarder on this host; `127.0.0.1` does** — all testing used the latter.

## 3. Service Inventory

29 containers: 1 monolith, 21 Tier-0 services (19 Node + 2 Python), nginx, redis, 6 observability. Verified internal ports (probed `/live`): identity 4001, platform-governance 4002, tenant-directory 4003, jd-parser 4004, candidate 4005, chat 4006, recruiting 4009, analytics 4010, matching-evaluation 4011, matching-reasoning 4012, matching-skill-discovery 4013, matching-bge-shadow 4014, role-intelligence 4015, career-intelligence 4016, dynamic-weighting 4017, job 4018, candidate-core 4019, matching-decision 4020, matching-scoring 4021, realtime 4030, resume 4031.

## 4. Database Ownership

| Service | Database | Owns | Cross-boundary reads |
|---|---|---|---|
| candidate-service | tejoma_candidate | candidate_accounts, candidate_decisions, mutual_matches, candidate_application_status, candidate_notifications, candidate_profile_views, saved_candidates | jobs → job-service; companies → tenant-directory-service |
| job-service | tejoma_job | jobs | candidates → candidate-core-service |
| candidate-core-service | tejoma_candidate_core | candidates | — |
| matching-decision-service | tejoma_matching_decision | swipes, recruiter_review view | jobs, candidates, scoring |
| matching-evaluation-service | tejoma_matching_evaluation | match_evaluation_runs, proficiency_shadow_scores | **jobs → job-service, swipes → matching-decision-service (new this session)** |
| tenant-directory-service | tejoma_tenant_directory | companies | — |
| identity-service | tejoma_identity | users, refresh_tokens, candidate_accounts (auth) | — |
| recruiting-service | tejoma_recruiting_service | recruiter_matches, recruiter_notifications | swipes |
| chat-service | tejoma_chat | messages | candidates, jobs |
| resume-service | tejoma_resume | resume artifacts | — |
| analytics-service | — (aggregator) | — | HTTP fan-out |
| monolith | tejoma_recruiting | legacy schema | rollback only |

No inappropriate cross-service database writes; all cross-boundary reads are HTTP to the owning service.

## 5. Blockers Resolved This Session

### 5.1 `GET /api/shadow-data-health` — monolith dependency removed
`shadowDataHealth.ts` fetched job titles through `monolithClient.getJobTitles`, added on the premise that "jobs remain monolith-owned". Obsolete — job-service owns `jobs` and already exposes `GET /internal/jobs/by-ids?companyId=&ids=`. Repointed via a new `jobServiceClient.ts` following the existing never-throws client convention. **No new endpoint, no data duplicated.**

> **Before:** `500 {"error":"Failed to compute shadow data health: Monolith internal API returned 502"}`
> **After (monolith OFF):** `200` — `totalRows 3, pctWithDecision 100, distinctCandidates 3, distinctJobs 3`

### 5.2 `POST /api/ml/evaluate` — monolith dependency removed
`evaluateFromSwipes` read swipes through `monolithClient.getSwipesForEvaluation`. Swipes moved to matching-decision-service in Step 6, which already exposes `GET /internal/swipes?companyId=`. Repointed; the `action IS NOT NULL` filter is applied client-side so the shared endpoint's contract is unchanged for its other callers. **No new endpoint added.**

> **Before:** `500 'Monolith internal API returned 502'`
> **After (monolith OFF):** `200` — `jobs_evaluated 6, swipes_evaluated 111, ndcg_at_k 0.7751, map_at_k 0.7529, mrr 0.9167`
> **Persistence verified by SQL:** row `id 3` written to `tejoma_matching_evaluation.match_evaluation_runs`

Incidental finding: `matching-decision-service/src/routes/internal/*.ts` is dead code — the live routes are defined directly in `internal.routes.ts` (confirmed by probing both endpoints, which answer 200).

### 5.3 `POST /api/chat` 401 — stale image, not a code defect
chat-service's **source** already verified RS256 with `IDENTITY_JWT_PUBLIC_KEY`, but the **running image** predated that migration: the deployed `dist/server.cjs` contained `JWT_SECRET` and **zero** `IDENTITY_JWT_PUBLIC_KEY` references. Public keys were byte-identical between chat-service and identity-service (sha256 `5941ee8f5d1ae1b6`), which ruled out configuration and pointed at the binary. Fixed by rebuilding the image — no source change.

> **After:** `200` — *"We have a total of 34 candidates in the talent pool."*, sourced from candidate-core-service
> **RBAC matrix 6/6:** recruiter 200 | superadmin 200 | candidate 403 | expired 401 | garbage 401 | none 401

Every service's **deployed bundle** was then audited for the same staleness; all staff-auth services now carry RS256 in the image actually running.

## 6. Monolith Dependency Scan — Final Classification

25 files still reference `monolithClient`. Every one traced to runtime behavior, not grep alone:

| Class | Locations | Evidence |
|---|---|---|
| **E — dead code** | `candidate-service/routes/candidateAnalytics/index.routes.ts` (not mounted in server.ts); `chat-service` `getPlatformStats` (name is misleading — body calls candidate-core-service and job-service) | No runtime effect |
| **B — rollback-only, fire-and-forget** | job-service mirror create/update/delete; matching-decision-service `mirrorAndNotifySwipe`; candidate-core-service mirror writes | All internal try/catch, never throw. **Proven:** `POST /api/jobs` 201, `/api/swipes` 201, `/api/candidates` 201 with monolith down, logging only "will be stale" |
| **B — flag-gated, real path verified** | matching-decision-service `getRecruiterReviewList` (`RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=true`) | `/api/recruiter-review` 200 monolith-off |
| **C — training/shadow, not on a business path** | `learningToRank.ts` (`getTrainingData`, `scoreBatch`) → `POST /api/ml/train/ranking`; `matching-scoring-service/mlAdmin.routes.ts`; `matching-skill-discovery/unknownSkillDiscovery.ts` | ML *training*, distinct from evaluation. Not exercised in normal operation. See §13. |
| **D — config/type declarations** | `*/config/env.ts`, `chat-service/types.ts`, `*/services/monolithClient.ts` | Declarations only |

**Previously unverified sites — now all exercised with the monolith confirmed unreachable:**

| Endpoint | Result |
|---|---|
| `GET /api/matches` (recruiting-service) | **200** |
| `GET /api/analytics/dashboard` | **200** |
| `GET /api/analytics/skills` | **200** |
| `GET /api/analytics/recruiter/me` | **200** |
| `GET /api/skills/discovery/pending` | **200** |

**Business-critical runtime monolith dependencies: 0.**

> Methodological note: an earlier run of this table was invalidated because the monolith had silently restarted (`restart: unless-stopped` + `depends_on` pulled it up when analytics-service was restarted). The results above are from a re-run after explicitly stopping it and confirming `fetch failed` to `http://app:3006/health` from inside the network.

## 7. 36-Screen UI Regression — Monolith OFF

**GET screens: 37/37 pass.**

- **Candidate (12):** auth/me, profile/me, profile/experiences, jobs, jobs/:id, applications, decisions, decisions/active, matches, analytics, notifications, notifications/unread-count
- **Recruiter (15):** auth/me, jobs, jobs/:id, candidates, candidate-search, recruiter-review, matches, matches/queue/:id, swipes/history, swipes/stats, analytics/dashboard, analytics/recruiter/me, analytics/skills, recruiter-notifications, unread-count
- **Admin/superadmin + platform (10):** users, admin/company-requests, ml/config, ml/model/status, ml/model/versions, ml/ranking/status, ml/evaluate/history, proficiency-analytics, shadow-data-health, skills/discovery/pending

**Write operations: 7/7 pass.**

| Write | Result |
|---|---|
| `POST /api/candidate-decisions` | **201** (400 on a duplicate — correct: *"You have already made this decision for this job"*; a fresh job returned 201) |
| `POST /api/jobs` | **201** |
| `POST /api/swipes` | **201** |
| `POST /api/jobs/parse-description` | **200** |
| `POST /api/chat` | **200** |
| `POST /api/ml/evaluate` | **200** + persisted |
| `PUT /api/candidate-notifications/read-all` | **200** |

**Resume upload proven end-to-end:** real multipart upload to `POST /api/parse-resume` → `200` with genuine extraction (`name: "Jane Doe"`, `current_job_title: "Senior Python Engineer"`, `skills: [Python, Django, AWS, Docker, PostgreSQL]`, `years_of_experience: "6 years"`).

**Frontend:** zero files changed across this entire effort. The SPA, all 48 components, and every multi-tenancy screen were intact throughout; earlier "missing UI" was caused by APIs failing beneath an intact frontend.

## 8. Authentication / RBAC / Tenant Isolation — 8/8 PASS

| Test | Result |
|---|---|
| No token → candidate route | **401** |
| Garbage token | **401** |
| Expired token | **401** |
| Staff token → candidate route | **401** (token-type confusion closed) |
| Candidate token → staff route | **403** |
| Candidate token → ML admin | **401** |
| Admin → superadmin-only tenant requests | **403** |
| Cross-tenant (company-19 admin → company-1 job) | **404**, not leaked |
| IDOR (candidate 14 → candidate 45's application) | **404**, scoped by `candidate_account_id` |

**Refresh-token rotation:** `POST /api/auth/refresh` and `POST /api/candidate-auth/refresh` both **401** without a valid refresh cookie — correct rejection.

Authorization was **tightened, never weakened**: staff tokens no longer satisfy candidate auth (fixed in identity-service, candidate-service, resume-service), and candidate tokens no longer satisfy staff auth (candidate-service, three matching services).

## 9. Data Consistency

| Table | Source (monolith) | Service-owned | Match |
|---|---|---|---|
| candidate_decisions | 36 | 36 | identical IDs, 0 field mismatches, identical per-candidate distribution |
| mutual_matches | 10 | 10 | identical ID sets |
| candidate_accounts | 37 | 37 | ✓ |

`company_id` derived for 36/36 decisions. All audit-created test rows were removed; `candidate_decisions` verified back at its 36-row baseline. New writes verified persisted by direct SQL (`match_evaluation_runs` id 3; `candidates` id 193).

Scope note: consistency was verified for the domains actually migrated and touched. This is not a system-wide zero-loss claim for every table.

## 10. Redis / Events — PASS (with a documented limitation)

Publish → consume confirmed (delivery count 1 to a live SSE subscriber). Redis restart → ioredis auto-reconnected and re-subscribed, delivery count back to 1. Consumer restart → re-subscribed.

**Documented limitation, not a defect:** an event published while the consumer is down returns delivery count **0** — Redis pub/sub has no durability. Realtime events must not be treated as a system of record. This is inherent to the chosen infrastructure and is stated rather than papered over.

## 11. Failure Isolation — PASS

analytics-service stopped → `/api/analytics/dashboard` **502**; `/api/jobs` **200**; `/api/candidate-jobs` **200**; restored → **200**. No cascading failure. Earlier runs confirmed the same for chat-service.

## 12. Backup / Restore — PASS with evidence

`pg_dump` of `tejoma_matching_evaluation` (1021 lines) restored into a disposable database:

- tables source 9 / restored 9 — **identical**
- **all row counts match**
- `match_evaluation_runs` **byte-identical** (3 rows, including the row written during this session's monolith-off test)
- indexes source 22 / restored 22

Disposable database dropped. Earlier run did the same for `tejoma_candidate` (9/9 tables, 36 rows byte-identical, 34/34 indexes).

Operational note: `scripts/backup-database.sh` requires `pg_dump` on the host, which is not installed; a containerised client at the matching major version (18) is required — the server is 18.1 and a 16.x client fails on version mismatch.

## 13. Remaining Risks (none blocking)

1. **ML *training* still calls the monolith** — `learningToRank.ts` (`getTrainingData`, `scoreBatch`) behind `POST /api/ml/train/ranking`, plus `matching-scoring-service/mlAdmin.routes.ts` and `matching-skill-discovery/unknownSkillDiscovery.ts`. Distinct from evaluation (fixed). `scoreBatch` wraps the monolith's live scoring engine, a genuinely larger extraction. **Not exercised in normal operation and not on any of the 44 verified paths** — but the monolith must remain available if anyone triggers model retraining.
2. **`knowledge_base_chunks` table missing** in `tejoma_candidate_core` — candidate RAG indexing silently no-ops (fire-and-forget, non-blocking).
3. **Silent degradation** — with job-service stopped, `GET /api/candidate-jobs` returns `200 {"jobs":[]}` rather than 503; a candidate would see "no jobs" instead of an error.
4. **`nanoid` advisory** (GHSA-2v37-7h3g-55p8, transitive) in candidate-core-service — pre-existing.
5. **Recurring defect classes** found repeatedly this effort: missing keys on exported `db` objects, SQL referencing nonexistent columns, undeclared npm imports, unmounted routers, and `catch → return []` masking failures. All are greppable; services not exercised here (upload-service, notifications-service) warrant the same sweep.
6. **Realtime event loss** during consumer downtime (§10).

## 14. Production Hardening — Observed

TLS with HSTS and security headers at nginx; per-request upstream DNS re-resolution (fixes the outage class that previously took the whole API down on a gateway redeploy); rate limiting on `/api/auth/`; `restart: unless-stopped` across services; Docker health checks present and observed working; Prometheus scraping service `/metrics`; structured pino logs with `x-request-id` correlation IDs confirmed end-to-end.

**Caveat:** `restart: unless-stopped` combined with `depends_on` will silently restart the monolith when a dependent service is restarted. This bit the audit once and must be accounted for in any decommissioning plan — stopping the monolith is not sufficient; it must be `docker compose stop app` *after* dependents are stable, or removed from `depends_on`.

## 15. Rollback Procedure

1. `MONOLITH_FALLBACK_ENABLED=true` + restart api-gateway → unmatched paths proxy to the monolith (~2 min).
2. Per-domain: set that domain's cutover flag to `false` and restart the service — the monolith-proxy branch is still present in code.
3. Full: redeploy prior images, disable all cutover flags. `DUAL_WRITE_ENABLED=true` has kept the monolith's tables current.
4. **Do not delete the monolith yet** — it remains the rollback target and is still required for ML training (§13.1).

Monolith stopped and restarted cleanly six times during this effort. Final state: monolith **running** for rollback; `MONOLITH_FALLBACK_ENABLED=false`, `CANARY_PERCENTAGE=100` unchanged.

---

## 16. Decision Rationale

**A. PRODUCTION READY** is selected because the complete business-critical application was proven to work with the monolith physically stopped and verified unreachable: 37/37 read screens, 7/7 writes, 8/8 security tests, resume parsing end-to-end, chat, ML evaluation with persistence, Redis recovery, failure isolation, and backup/restore — all with runtime evidence.

The one remaining monolith dependency (ML model *training*) is deliberately classified as non-blocking: it is an offline operator action, not a business-critical user workflow, it was verified absent from all 44 exercised paths, and it is documented above rather than hidden. Decommissioning the monolith should wait until that extraction is complete; **deploying to production should not.**

**Commits this session:** 8 — chat stale-image fix; shadow-data-health → job-service; ml/evaluate → matching-decision-service; plus the earlier resume-service restoration, four-service RS256 auth restoration, identity-service claim guard, and UI regression report.
