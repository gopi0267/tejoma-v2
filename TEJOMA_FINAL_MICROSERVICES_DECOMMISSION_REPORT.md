# TEJOMA FINAL MICROSERVICES DECOMMISSION REPORT

**Date:** 2026-08-12
**Method:** Runtime evidence only — authenticated HTTP through nginx (`https://127.0.0.1`), real SQL against service-owned databases, monolith physically stopped with `app:3006` confirmed unreachable from inside the Docker network before every monolith-off assertion.

---

## 1. FINAL DECISION

# A. PRODUCTION READY — MONOLITH CAN BE DECOMMISSIONED

**Zero business-critical monolith dependencies remain.** The last one — `POST /api/ml/train` — was migrated this session, and the complete application was then proven working with the monolith physically stopped:

| Category | Result (monolith OFF) |
|---|---|
| Read screens | **37/37** |
| Writes incl. all 3 ML endpoints | **10/10** |
| Security / RBAC / tenant isolation | **12/12** |
| Redis publish + restart recovery | PASS |
| Failure isolation, no cascade | PASS |
| Backup / restore | PASS, byte-identical |
| Monolith auto-restart possible? | **No** — proven 3× |

---

## 2. The Final Migration: `POST /api/ml/train`

matching-scoring-service proxied to the monolith's `/internal/ml/train`, so classification-ensemble retraining 502'd whenever the monolith was down. **Ported, not removed or faked** — the endpoint performs real training.

**What moved:**
- `feedbackSignals.ts` copied **verbatim** (108 lines of pure label/weight resolution — no DB, no HTTP). Only the `Swipe` type was localized.
- `trainEnsembleModel.ts` reproduces `trainModelOnStartup`'s orchestration exactly. The label taxonomy, per-sample weights, both early-return paths with their log messages, and `updateLastTrainingTimestamp()` firing regardless of outcome are all unchanged — a behavioural change here would silently produce a *differently-trained model* rather than a visible error.
- Everything downstream (`computeMatchFeatures`, `computeBertCosineScore`, `buildFeatureVector`, `trainEnsemble`) already lived in this service; two private helpers were exported.

**Where data now comes from** — four monolith-local reads replaced by the owning services:

| Dataset | Owner | Endpoint |
|---|---|---|
| swipes | matching-decision-service | `GET /internal/swipes/all` |
| candidates | candidate-core-service | `GET /internal/candidates/all` |
| jobs | job-service | `GET /internal/jobs/all` |
| application status | candidate-service | `GET /internal/application-status/all` *(added)* |

> **Schema finding that simplified the port.** The monolith JOINed `candidate_application_status` to `candidates` because **its** copy was keyed by `candidate_account_id`. candidate-service's table is keyed by `candidate_id` — the same candidate-core id swipes use — so no join is needed at all. My first attempt assumed the monolith's shape and 500'd on a nonexistent column; the query was rewritten against the live schema.

**Evidence:**

| Condition | Result |
|---|---|
| Monolith **UP** | `trained:true, sampleCount:113, cvAccuracy:{randomForest:0.6897, xgboost:0.6632, lightgbm:0.6909}` |
| Monolith **OFF** (port 3006 unreachable) | **identical** |
| RBAC | recruiter **403**, candidate **401**, no token **401**, `model/status` **200** |

## 3. All Three ML Endpoints Now Monolith-Free

| Endpoint | Before | Now (monolith OFF) |
|---|---|---|
| `POST /api/ml/evaluate` | 500 (monolith 502) | **200** — nDCG 0.7751 over 111 swipes, persisted |
| `POST /api/ml/train/ranking` | 500 (monolith 502) | **200** — `trained:true`, 112 examples, 6 groups, persisted |
| `POST /api/ml/train` | 502 | **200** — `trained:true`, 113 samples, real CV accuracies |

## 4. Additional Defect Found

`db.query` was missing from candidate-service's exported `db` object — the **fifth** occurrence of this class in this repo (`candidate-service` `db.pool`, `candidate-core-service` `db.query`, `job-service` `db.query`, `matching-decision-service` `getLatestSwipesByCandidateIds`). Each produced a runtime `TypeError` surfaced as a generic 500. **This pattern is worth a standing lint rule.**

## 5. Final Architecture

```
Browser
  → nginx :443 (TLS, SPA; per-request upstream DNS re-resolution)
      → api-gateway :4000 (explicit routes; MONOLITH_FALLBACK_ENABLED=false, CANARY_PERCENTAGE=100)
          → 21 Tier-0 microservices, each owning its Postgres database
          → app :3006 — STOPPED during validation, zero business dependencies, rollback only
  Redis :6379 — pub/sub (realtime-service), BullMQ retrain queue
  Postgres 18.1 — native on host, 22 tejoma_* databases
```

29 containers: 1 monolith, 21 Tier-0 (19 Node + 2 Python), nginx, redis, 6 observability.

## 6. Database Ownership Matrix

| Service | Database | Owns | Cross-boundary reads (HTTP only) |
|---|---|---|---|
| candidate-service | tejoma_candidate | candidate_accounts, candidate_decisions, mutual_matches, candidate_application_status, candidate_notifications, candidate_profile_views, saved_candidates | jobs → job-service; companies → tenant-directory-service |
| job-service | tejoma_job | jobs | candidates → candidate-core-service |
| candidate-core-service | tejoma_candidate_core | candidates | — |
| matching-decision-service | tejoma_matching_decision | swipes, recruiter_review view | jobs, candidates, scoring |
| matching-scoring-service | tejoma_matching_scoring | matching_model_config, match_features | **swipes, candidates, jobs, application status (ML training)** |
| matching-evaluation-service | tejoma_matching_evaluation | match_evaluation_runs, ltr_model_versions, proficiency_shadow_scores | swipes, jobs, scoring |
| tenant-directory-service | tejoma_tenant_directory | companies | — |
| identity-service | tejoma_identity | users, refresh_tokens, candidate_accounts (auth) | — |
| recruiting-service | tejoma_recruiting_service | recruiter_matches, recruiter_notifications | swipes |
| chat-service | tejoma_chat | messages | candidates, jobs |
| resume-service | tejoma_resume | resume artifacts | — |
| analytics-service | — (aggregator) | — | HTTP fan-out |
| monolith | tejoma_recruiting | legacy schema | **none — rollback only** |

**No cross-service database writes.** All cross-boundary access is HTTP to the owning service.

## 7. Monolith Dependency Scan — Final Classification

| Class | Locations | Runtime evidence |
|---|---|---|
| **A — business-critical** | **NONE** | All previously-A endpoints now 200 monolith-off |
| **B — rollback-only, fire-and-forget** | job-service `mirrorAndNotifyJobCreate/Update/Delete`; matching-decision-service `mirrorAndNotifySwipe`; candidate-core-service mirror writes | Logged `"Failed to mirror … will be stale"` while the same requests returned **201**. Non-blocking, proven. |
| **B — flag-gated, real path verified** | matching-decision-service `getRecruiterReviewList` | `/api/recruiter-review` **200** monolith-off |
| **E — dead code** | `candidate-service/routes/candidateAnalytics/index.routes.ts` (not mounted); `chat-service` `getPlatformStats` (calls candidate-core + job-service, not the monolith); `matching-decision-service/src/routes/internal/*.ts` (live routes are in `internal.routes.ts`); now-unused `monolithClient` exports in matching-evaluation-service and matching-scoring-service | No runtime effect |
| **D — config / type declarations** | `*/config/env.ts`, `chat-service/types.ts` | Declarations only |

## 8. Docker Dependency Audit — FIXED

**12 Tier-0 services declared `depends_on: app` with `condition: service_healthy`.** Two real problems: `docker compose up -d <any-dependent>` **silently started the monolith** (this invalidated an earlier monolith-off run), and the stack refused to start if the monolith was unhealthy.

All 12 removed. **Proven three separate times** with the monolith stopped:

| Action | Monolith after |
|---|---|
| `up -d --no-deps candidate-service` | Exited (0) |
| `up -d analytics-service` (full dependency chain) | Exited (0) |
| `start analytics-service` during failure-isolation testing | Exited (0) |

## 9. Workflow Evidence (monolith OFF)

**Candidate (12/12):** auth/me, profile/me, profile/experiences, jobs, job details, applications, decisions, decisions/active, matches, analytics, notifications, unread-count. Writes: decision **201**, notifications read-all **200**.

**Recruiter (15/15):** auth/me, jobs, job details, candidates, candidate-search, recruiter-review, matches, match queue, swipes/history, swipes/stats, analytics dashboard, analytics recruiter/me, analytics skills, recruiter-notifications, unread-count. Writes: job creation **201**, swipe **201**, JD parsing **200**, resume parsing **200** (real multipart upload).

**Admin / superadmin (10/10):** users, admin/company-requests, ml/config, ml/model/status, ml/model/versions, ml/ranking/status, ml/evaluate/history, proficiency-analytics, shadow-data-health, skills/discovery/pending.

**Multi-tenancy:** company registration **422** on empty body (route live, validating); approval queue **200** for superadmin, **403** for admin and recruiter; company context present in `/api/auth/me` (`company_id`, `company{id,name,plan}`); user management **200**.

## 10. Security / RBAC / Tenant Isolation — 12/12 PASS

No token **401** · garbage **401** · expired **401** · staff→candidate route **401** · candidate→staff route **403** · candidate→ML admin **401** · recruiter→superadmin-only **403** · admin→superadmin-only **403** · cross-tenant job (co-19→co-1) **404** · IDOR (cand14→cand45) **404** · `/api/auth/refresh` no cookie **401** · `/api/candidate-auth/refresh` no cookie **401**.

Authorization was **tightened, never weakened** across this migration: staff tokens no longer satisfy candidate auth (identity-service, candidate-service, resume-service); candidate tokens no longer satisfy staff auth (candidate-service, three matching services). **No authorization failure returns a fake empty success** — that anti-pattern was found and eliminated.

## 11. Data Consistency

| Table | Source | Service-owned | Match |
|---|---|---|---|
| candidate_decisions | 36 | 36 | identical IDs, 0 field mismatches |
| mutual_matches | 10 | 10 | identical ID sets |
| candidate_accounts | 37 | 37 | ✓ |

New writes verified persisted by SQL: `ltr_model_versions` id 3, `match_evaluation_runs` id 3. All audit test rows removed; `candidate_decisions` verified back at its 36-row baseline.

## 12. Redis / Events — PASS (documented limitation)

Publish → consume delivered to 1 live subscriber. Redis restart → auto-reconnect and re-subscribe. Consumer restart → re-subscribed.

**Limitation stated, not hidden:** an event published while the consumer is down is **lost** (delivery count 0). Redis pub/sub provides no durability. Realtime events must not be treated as a system of record.

## 13. Failure Isolation — PASS

analytics-service stopped → `/api/analytics/dashboard` **502**, `/api/jobs` **200**, `/api/candidate-jobs` **200**; restored → **200**. No cascade. Monolith remained `Exited` throughout.

## 14. Backup / Restore — PASS

`tejoma_matching_decision`: 4/4 tables, all row counts match, `swipes` **byte-identical (115 rows)**, 10/10 indexes. Also verified for `tejoma_candidate` (9/9 tables, 34/34 indexes) and `tejoma_matching_evaluation` (9/9 tables, 22/22 indexes). Disposable databases dropped after each run.

**Operational note:** `scripts/backup-database.sh` needs `pg_dump` on the host, which is not installed. Use a containerised client at the **matching major version** — the server is 18.1 and a 16.x client fails on version mismatch.

## 15. Production Hardening — Verified

TLS with HSTS and security headers; per-request upstream DNS re-resolution (fixes the outage class that previously took the entire API down on a gateway redeploy); rate limiting on `/api/auth/`; `restart: unless-stopped`; health checks working; Prometheus scraping `/metrics`; structured pino logs with `x-request-id` correlation IDs confirmed end-to-end.

## 16. Remaining Risks (none blocking)

1. **Realtime events are lossy** during consumer downtime (§12).
2. **`knowledge_base_chunks` missing** in `tejoma_candidate_core` — candidate RAG indexing silently no-ops (fire-and-forget).
3. **Silent degradation** — with job-service stopped, `GET /api/candidate-jobs` returns `200 {"jobs":[]}` rather than 503; a candidate sees "no jobs" instead of an error.
4. **`nanoid` advisory** (GHSA-2v37-7h3g-55p8, transitive) in candidate-core-service.
5. **`companies` unreconciled** — 19 rows in the monolith DB vs 18 in tenant-directory-service.
6. **Recurring defect classes** across this migration: missing keys on exported `db` objects (**5×**), SQL referencing nonexistent columns, undeclared npm imports, unmounted routers, `catch → return []` masking failures, stale Docker images hiding correct source. Services never exercised (upload-service, notifications-service) warrant the same sweep.

## 17. Decommission Procedure

**Now:**
1. `docker compose stop app`. Nothing routes to it, nothing depends on it.
2. Monitor 48h. Any need to start it indicates an unmapped dependency.

**Then:**
3. Remove the `app` service from `docker-compose.yml`; delete `src/api/*-internal.routes.ts` and each service's `services/monolithClient.ts` (all class B/E).
4. Set `DUAL_WRITE_ENABLED=false`; stop mirroring into `tejoma_recruiting`.
5. **Retain `tejoma_recruiting` as a cold backup ≥30 days** — it still holds legacy tables, and `companies` is unreconciled (§16.5).

## 18. Rollback Procedure

1. `docker compose start app`, set `MONOLITH_FALLBACK_ENABLED=true`, restart api-gateway → unmatched paths proxy to the monolith (~2 min).
2. Per-domain: set that domain's cutover flag to `false` and restart the service — the monolith-proxy branch is still in code.
3. Full: redeploy prior images, disable all cutover flags. `DUAL_WRITE_ENABLED=true` has kept `tejoma_recruiting` current.

Monolith stopped and restarted cleanly ten times across this effort. **Final state: monolith running for rollback; `MONOLITH_FALLBACK_ENABLED=false`, `CANARY_PERCENTAGE=100` unchanged; all services healthy.**

---

## 19. Why "A"

The decision rule required zero business-critical monolith dependencies, complete workflows working with the monolith physically off, ML dependencies resolved, auth/RBAC/tenant isolation verified, data consistency verified, Redis/events working as designed, backup/restore verified, failure isolation verified, Docker unable to restart the monolith, and runtime evidence throughout.

**Every one is met with runtime evidence**, including the ML training dependency that forced verdict B in the previous report. The monolith is now a rollback artifact with no business function.

**Per instruction, the monolith has NOT been deleted** — independence is proven first; deletion is step 3 of §17, at your discretion.
