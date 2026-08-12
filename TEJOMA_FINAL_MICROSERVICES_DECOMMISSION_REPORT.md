# TEJOMA FINAL MICROSERVICES DECOMMISSION REPORT

**Date:** 2026-08-12
**Question answered:** *Can the monolith be safely decommissioned?*
**Method:** Runtime evidence only — authenticated HTTP through nginx (`https://127.0.0.1`), real SQL against service-owned databases, monolith physically stopped and `app:3006` confirmed unreachable from inside the Docker network before every monolith-off assertion.

---

## 1. VERDICT

# NOT YET — one endpoint blocks full decommissioning

**The application is production-ready and runs entirely without the monolith.** Every user-facing candidate, recruiter, admin and superadmin workflow was proven working with the monolith stopped: **37/37 read screens, 9/9 writes, 12/12 security tests**.

**One administrative endpoint still requires the monolith:**

| Endpoint | Status monolith-off | Impact |
|---|---|---|
| `POST /api/ml/train` (classification-model retraining) | **502** | Blocks deletion of the monolith |

This is **not** a regression from this session — it has always proxied to the monolith, and `git log` confirms the file has not been touched since `7ded58d`. It is an offline operator action, not a user workflow.

**Recommendation: keep the monolith stopped, not deleted.** It can remain powered off indefinitely with zero impact on the running application; start it only to retrain the classification model, or complete the port in §5 to delete it outright.

---

## 2. The Last Dependency Removed This Session: `/api/ml/train/ranking`

The endpoint named in the brief is **fully migrated**. It needed two things from the monolith:

**(a) `getTrainingData()`** — unscoped swipes + candidates + jobs in one proxy call. Now assembled from the owners in parallel:

| Dataset | Owning service | Endpoint | Status |
|---|---|---|---|
| swipes | matching-decision-service | `GET /internal/swipes/all` | **added this session** |
| candidates | candidate-core-service | `GET /internal/candidates/all` | already existed |
| jobs | job-service | `GET /internal/jobs/all` | already existed |

Only the swipes endpoint was new, added to the service that owns the table, following the exact `/all` convention the other two already used for this same training/reindex case. Unscoped is deliberate and correct — the ranker trains globally, not per tenant, matching the monolith's own `getAllSwipesUnscoped`. None are Gateway-reachable (`proxy.ts` 404s `/internal/*` unconditionally).

**(b) `scoreBatch()`** — the live scoring engine. matching-scoring-service owns `calculateMatchScoresBatch` outright and already exposed it at `POST /internal/rank-candidates-for-job`, whose `RankedCandidate` carries the full `MatchScoreResult` including `feature_vector`. **No new endpoint added.**

> **Correctness detail worth recording.** `rankCandidatesForJob` **sorts by `match_score`**, whereas the monolith's `scoreBatch` preserved input order and `learningToRank` zipped relevance labels **positionally** (`relevanceByIndex[i]`). Consuming the sorted array positionally would have paired each candidate's grade with a *different* candidate's feature vector — silently training the ranker on mislabelled data, with no error raised anywhere. The new client returns a `candidateId → feature_vector` map and the caller aligns by identity, so upstream sort order cannot corrupt labels. `persist` is omitted so training writes no `match_scores`/`match_features` rows as a side effect.

**Evidence:**

| Condition | Result |
|---|---|
| Monolith **UP** (baseline) | `{"trained":true,"exampleCount":112,"groupCount":6}` |
| Monolith **OFF**, confirmed unreachable | `{"trained":true,"exampleCount":112,"groupCount":6}` — identical |
| Persistence | `ltr_model_versions` id 3 — 112 examples, 6 groups, `is_active:false` |
| RBAC | recruiter **403**, candidate **401**, no token **401**, status endpoint **200** |

## 3. Additional Defects Found and Fixed While Doing This

1. **`db.getLatestSwipesByCandidateIds` was never added to matching-decision-service's exported `db` object** — `/internal/swipes/latest-by-candidate-ids` crashed the request (socket closed). Same missing-export-key class as `candidate-service` `db.pool`, `candidate-core-service` `db.query`, `job-service` `db.query` fixed earlier in this migration. **Fourth occurrence.**
2. **`MATCHING_ML_SERVICE_URL` / `JD_NLP_SERVICE_URL` were set only on `app`** — every Node service fell back to a `localhost` default and could not reach the Python services from inside its own container. This is why training first reported *"Matching ML service unavailable"* despite the service being healthy. Both added to the shared `x-service-urls` anchor.

## 4. Docker Restart / Dependency Behaviour — FIXED

**12 Tier-0 services declared `depends_on: app` with `condition: service_healthy`.** Two real problems:

1. `docker compose up -d <any-dependent>` **silently started the monolith**. This invalidated a monolith-off test run during the previous audit — results looked clean because the monolith had quietly come back up underneath them, caught only by re-checking container status mid-test.
2. The whole stack refused to start if the monolith was unhealthy — precisely the coupling this migration exists to remove.

All 12 removed. **Proof, with the monolith stopped:**

| Action | Monolith state after |
|---|---|
| `docker compose up -d --no-deps candidate-service` | **Exited (0)** |
| `docker compose up -d analytics-service` (full dependency chain) | **Exited (0)** |
| `docker compose start analytics-service` during failure-isolation testing | **Exited (0)** |

The monolith now starts only when started explicitly.

## 5. Remaining Monolith Dependency — Exact Fix Path

**`POST /api/ml/train`** → `matching-scoring-service` → `monolithClient.trainModel()` → monolith `POST /internal/ml/train` → `trainModelOnStartup()`.

This is a **port, not a repoint** — unlike the LTR trainer, the logic itself does not exist outside the monolith. What it needs and where each piece is:

| Requirement | Status |
|---|---|
| swipes / candidates / jobs (unscoped) | **Solved** — reuse `trainingDataClient.ts` built this session |
| `computeMatchFeatures`, `buildFeatureVector` | **Present** in matching-scoring-service `services.ts` |
| `getEnsembleHealth`, `setRetrainingStatus`, `activeModelType` | **Present** in matching-scoring-service |
| `candidate_application_status` (unscoped) | Owned by candidate-service (`tejoma_candidate`, currently **0 rows**) — needs a new `/internal` endpoint |
| `feedbackSignals.resolveTrainingSamples` | **Not present** — must be ported from the monolith |
| `computeBertCosineScore` | Must be confirmed present or ported |

Estimated as a contained port of ~100 lines plus one internal endpoint. **Deliberately not rushed here** — a half-finished training pipeline risks exactly the silent mislabelling class documented in §2, which produces a subtly wrong model rather than a visible error.

## 6. Final Monolith-Off Evidence

Monolith `Exited (0)`; `fetch http://app:3006/health` from inside the network → timeout/refused, re-confirmed before each block.

**Reads: 37/37.** Candidate (12): auth/me, profile/me, profile/experiences, jobs, jobs/:id, applications, decisions, decisions/active, matches, analytics, notifications, unread-count. Recruiter (15): auth/me, jobs, jobs/:id, candidates, candidate-search, recruiter-review, matches, matches/queue/:id, swipes/history, swipes/stats, analytics/dashboard, analytics/recruiter/me, analytics/skills, recruiter-notifications, unread-count. Admin/platform (10): users, admin/company-requests, ml/config, ml/model/status, ml/model/versions, ml/ranking/status, ml/evaluate/history, proficiency-analytics, shadow-data-health, skills/discovery/pending.

**Writes: 9/9.**

| Write | Result |
|---|---|
| `POST /api/candidate-decisions` | **201** |
| `POST /api/jobs` | **201** |
| `POST /api/swipes` | **201** |
| `POST /api/jobs/parse-description` | **200** |
| `POST /api/chat` | **200** |
| `POST /api/ml/evaluate` | **200** |
| `POST /api/ml/train/ranking` | **200**, `trained:true` |
| `PUT /api/candidate-notifications/read-all` | **200** |
| `POST /api/parse-resume` (real multipart upload) | **200** |

## 7. Security / RBAC / Tenant Isolation — 12/12 PASS (monolith off)

No token **401** · garbage token **401** · expired token **401** · staff→candidate route **401** · candidate→staff route **403** · candidate→ML admin **401** · recruiter→superadmin-only **403** · admin→superadmin-only **403** · cross-tenant job (co-19→co-1) **404** · IDOR (cand14→cand45) **404** · `POST /api/auth/refresh` no cookie **401** · `POST /api/candidate-auth/refresh` no cookie **401**.

Authorization was **tightened, never weakened**, across this migration: staff tokens no longer satisfy candidate auth (identity-service, candidate-service, resume-service), and candidate tokens no longer satisfy staff auth (candidate-service, three matching services).

## 8. Data Consistency

| Table | Source | Service-owned | Match |
|---|---|---|---|
| candidate_decisions | 36 | 36 | identical IDs, 0 field mismatches |
| mutual_matches | 10 | 10 | identical ID sets |
| candidate_accounts | 37 | 37 | ✓ |

New writes verified persisted by direct SQL: `ltr_model_versions` id 3, `match_evaluation_runs` id 3. All audit test rows removed; `candidate_decisions` verified back at its 36-row baseline.

## 9. Redis / Events — PASS (documented limitation)

Publish → consume delivered to 1 live subscriber. Redis restart → auto-reconnect and re-subscribe, delivery back to 1. Consumer restart → re-subscribed.

**Limitation, stated not hidden:** an event published while the consumer is down is **lost** (delivery count 0). Redis pub/sub has no durability. Realtime events must not be treated as a system of record.

## 10. Failure Isolation — PASS

analytics-service stopped → `/api/analytics/dashboard` **502**, `/api/jobs` **200**, `/api/candidate-jobs` **200**; restored → **200**. No cascading failure. The monolith remained `Exited` throughout.

## 11. Backup / Restore — PASS

`pg_dump` of `tejoma_matching_decision` (436 lines) restored into a disposable database: tables 4/4 identical, **all row counts match**, `swipes` **byte-identical (115 rows)**, indexes 10/10. Disposable database dropped. Earlier runs verified `tejoma_candidate` (9/9 tables, 34/34 indexes) and `tejoma_matching_evaluation` (9/9 tables, 22/22 indexes).

**Operational note:** `scripts/backup-database.sh` requires `pg_dump` on the host, which is not installed. Use a containerised client at the matching major version — the server is **18.1**, and a 16.x client fails on version mismatch.

## 12. Final Dependency Scan — Classification

26 files reference `monolithClient`. Every one traced to runtime behaviour, not grep:

| Class | Locations | Evidence |
|---|---|---|
| **A — runtime business dependency** | `matching-scoring-service/routes/mlAdmin.routes.ts` → `trainModel` | **`POST /api/ml/train` → 502 monolith-off.** The only one. |
| **B — rollback-only, fire-and-forget** | job-service mirror create/update/delete; matching-decision-service `mirrorAndNotifySwipe`; candidate-core-service mirror writes | All internal try/catch, never throw. Proven: `POST /api/jobs` **201**, `/api/swipes` **201** monolith-off, logging only "will be stale" |
| **B — flag-gated, real path verified** | matching-decision-service `getRecruiterReviewList` | `/api/recruiter-review` **200** monolith-off |
| **E — dead code** | `candidate-service/routes/candidateAnalytics/index.routes.ts` (not mounted); `chat-service` `getPlatformStats` (body calls candidate-core-service and job-service, not the monolith); `matching-decision-service/src/routes/internal/*.ts` (live routes are in `internal.routes.ts`) | No runtime effect |
| **E — now-unused imports** | `matching-evaluation-service/services/monolithClient.ts` (`getTrainingData`/`scoreBatch`/`getSwipesForEvaluation`/`getJobTitles` no longer called) | Retained for rollback; safe to delete after decommission |
| **D — config / type declarations** | `*/config/env.ts`, `chat-service/types.ts` | Declarations only |

**Previously-unverified sites, all now exercised monolith-off:** `GET /api/matches` **200** · `/api/analytics/dashboard` **200** · `/api/analytics/skills` **200** · `/api/analytics/recruiter/me` **200** · `/api/skills/discovery/pending` **200**.

**Business-critical runtime monolith dependencies on user-facing workflows: 0. Administrative: 1 (`POST /api/ml/train`).**

## 13. Remaining Risks

1. **`POST /api/ml/train` requires the monolith** (§5) — blocks deletion, not operation.
2. **Realtime events are lossy** during consumer downtime (§9).
3. **`knowledge_base_chunks` missing** in `tejoma_candidate_core` — candidate RAG indexing silently no-ops (fire-and-forget).
4. **Silent degradation** — with job-service stopped, `GET /api/candidate-jobs` returns `200 {"jobs":[]}` rather than 503; a candidate sees "no jobs" instead of an error.
5. **`nanoid` advisory** (GHSA-2v37-7h3g-55p8, transitive) in candidate-core-service.
6. **Recurring defect classes** across this migration: missing keys on exported `db` objects (**4 occurrences**), SQL referencing nonexistent columns, undeclared npm imports, unmounted routers, `catch → return []` masking failures, and stale Docker images hiding correct source. Services never exercised here (upload-service, notifications-service) warrant the same sweep.

## 14. Decommission Procedure

**Now — safe immediately:**
1. Keep the monolith **stopped**: `docker compose stop app`. Nothing routes to it (`MONOLITH_FALLBACK_ENABLED=false`) and no service depends on it.
2. Monitor for 48h. Any need to start it indicates an unmapped dependency.

**Before deletion — required:**
3. Complete the `POST /api/ml/train` port (§5), or accept that classification retraining is unavailable.
4. Re-run the full monolith-off suite (§6, §7) and confirm `POST /api/ml/train` returns 200.
5. Re-run the dependency scan; class **A** must be empty.

**Then — deletion:**
6. Remove the `app` service from `docker-compose.yml`; delete `src/api/*-internal.routes.ts` and each service's `services/monolithClient.ts`.
7. Set `DUAL_WRITE_ENABLED=false` and stop mirroring into `tejoma_recruiting`.
8. **Retain `tejoma_recruiting` as a cold backup for at least 30 days** — it is still the only home of some legacy tables, and `companies` differs between it (19) and tenant-directory-service (18), unreconciled.

## 15. Rollback Procedure

1. `docker compose start app`, set `MONOLITH_FALLBACK_ENABLED=true`, restart api-gateway → unmatched paths proxy to the monolith (~2 min).
2. Per-domain: set that domain's cutover flag to `false` and restart the service — the monolith-proxy branch is still present in code.
3. Full: redeploy prior images and disable all cutover flags. `DUAL_WRITE_ENABLED=true` has kept `tejoma_recruiting` current.

Monolith stopped and restarted cleanly eight times across this effort. **Final state: monolith running for rollback; `MONOLITH_FALLBACK_ENABLED=false`, `CANARY_PERCENTAGE=100` unchanged; all services healthy.**

---

## 16. Answer

**Can the monolith be safely decommissioned?**

**It can be safely SHUT DOWN today** — proven by 37/37 reads, 9/9 writes, 12/12 security tests, Redis recovery, failure isolation and backup/restore, all with `app:3006` verified unreachable.

**It cannot yet be DELETED** — `POST /api/ml/train` still proxies to it. That endpoint is an offline admin action with no user-facing impact, and §5 gives the exact remaining work.

The distinction is the point: **stop it now, delete it after the §5 port.**
