# TEJOMA FINAL MICROSERVICES DECOMMISSION REPORT

**Date:** 2026-08-12
**Status:** Monolith removed from the runtime deployment
**Method:** Runtime evidence only — authenticated HTTP through nginx (`https://127.0.0.1`), real SQL against service-owned databases, with the monolith container **deleted**, not merely stopped.

---

## 1. FINAL VERDICT

# PRODUCTION READY — MONOLITH DECOMMISSIONED

The `app` service no longer exists in `docker-compose.yml`, the `tejoma-app-1` container has been removed, and no service holds a resolvable monolith URL. The complete application was then re-verified end to end:

| Category | Result (monolith removed) |
|---|---|
| Read screens | **37/37** |
| Writes, incl. all 3 ML endpoints | **10/10** |
| Security / RBAC / tenant isolation | **12/12** |
| Multi-tenancy | PASS |
| Redis publish/consume | PASS |
| Failure isolation, no cascade | PASS |
| Backup / restore | PASS, row counts identical |
| Services healthy | **31/31** |
| Monolith reappears on restart? | **No** |

---

## 2. Decommission Sequence Executed

| Step | Evidence |
|---|---|
| 1. Rollback point recorded | commit `aa8584d`, tagged `pre-monolith-decommission`, clean tree |
| 2. Full backup | 14 databases, 6.0 MB |
| 3. Backup restore-verified **before** removing anything | `tejoma_recruiting` → disposable DB: **37/37 tables**, all row counts matched, swipes 111/111 |
| 4. Monolith stopped | `Exited (0)` |
| 5. Port unreachable | `app:3006` fetch failed from api-gateway; `bad address 'app:3006'` from nginx |
| 6. Cannot auto-restart | stayed `Exited` after starting a dependent, and after starting one *with* its full dependency chain |
| 7. Removed from deployment | `app` service block deleted from compose; `tejoma-app-1` container removed |
| 8. Config cleaned | see §3 |
| 9. Images rebuilt | 11 services, exit 0 |
| 10. Stack started without monolith | 31 services, all healthy |
| 11. Full test suite re-run | §5–§9 |

## 3. Runtime Configuration Removed

- `app` service block deleted from `docker-compose.yml`
- `MONOLITH_INTERNAL_URL` / `MONOLITH_URL` removed from the shared `x-service-urls` anchor
- **11** per-service `MONOLITH_INTERNAL_URL` overrides and **1** `MONOLITH_URL` override removed
- `MONOLITH_URL` removed from api-gateway's `REQUIRED_ALWAYS` — it would have **refused to start** without it
- `MONOLITH_INTERNAL_URL` removed from `REQUIRED_ALWAYS` in **12 services** — same problem
- `.env.local`: monolith vars commented out with rollback instructions; `DUAL_WRITE_ENABLED=false` (no source left to mirror from)

**Runtime proof:** every service now reports empty `MONOLITH_INTERNAL_URL` and `MONOLITH_URL`, and api-gateway computes `fallback = false`.

## 4. Hardening Applied During Removal

Three defects found and fixed while decommissioning — none would have surfaced from configuration review alone:

1. **Fallback defaulted to ON.** `MONOLITH_FALLBACK_ENABLED = process.env.X !== 'false'` evaluates to **true when unset**. Post-decommission that would proxy unmatched paths at an empty target, producing connection errors instead of the clean 404 the strangler-fig fallback is meant to degrade to. Now force-disabled whenever `MONOLITH_URL` is empty — *fallback is only meaningful when there is something to fall back to.*
2. **`resume-service`'s `UPLOAD_SERVICE_URL` pointed at `app:3006`** — the monolith, not upload-service. Latent rather than an active break; corrected to `upload-service:4030`.
3. **13 services would have refused to boot** after removal, because the monolith URL was a hard startup requirement. Caught before starting the stack, not after an outage.

## 5. Final Application Test — Monolith Removed

**Reads: 37/37.** Candidate (12): auth/me, profile/me, profile/experiences, jobs, job details, applications, decisions, decisions/active, matches, analytics, notifications, unread-count. Recruiter (15): auth/me, jobs, job details, candidates, candidate-search, recruiter-review, matches, match queue, swipes/history, swipes/stats, analytics dashboard, analytics recruiter/me, analytics skills, recruiter-notifications, unread-count. Admin/platform (10): users, admin/company-requests, ml/config, ml/model/status, ml/model/versions, ml/ranking/status, ml/evaluate/history, proficiency-analytics, shadow-data-health, skills/discovery/pending.

**Writes: 10/10.**

| Write | Result |
|---|---|
| `POST /api/candidate-decisions` | **201** |
| `POST /api/jobs` | **201** |
| `POST /api/swipes` | **201** |
| `POST /api/jobs/parse-description` | **200** |
| `POST /api/chat` | **200** |
| `POST /api/ml/evaluate` | **200** |
| `POST /api/ml/train/ranking` | **200** |
| `POST /api/ml/train` | **200** |
| `PUT /api/candidate-notifications/read-all` | **200** |
| `POST /api/parse-resume` (real multipart upload) | **200** |

## 6. Security / RBAC / Tenant Isolation — 12/12

No token **401** · garbage **401** · expired **401** · staff→candidate route **401** · candidate→staff route **403** · candidate→ML admin **401** · recruiter→superadmin-only **403** · admin→superadmin-only **403** · cross-tenant job (co-19→co-1) **404** · IDOR (cand14→cand45) **404** · `auth/refresh` no cookie **401** · `candidate-auth/refresh` no cookie **401**.

Authorization was **tightened, never weakened** across this migration. No authorization failure returns a fake empty success — that anti-pattern was found and eliminated.

## 7. Multi-Tenancy — PASS

`POST /api/company-registration` **422** on empty body (live, validating) · approval queue **200** superadmin, **403** admin, **403** recruiter · company context present in `/api/auth/me` (`"company":{"id":1,"name":"Tejoma Corp","plan":"pro"}`) · user management **200**.

**Note on visibility:** `user-management` (adminOnly) and `tenant-requests` (superadminOnly) are hidden for the `recruiter` role by `Sidebar.tsx`'s filter, and the backend independently returns **403**. A recruiter sees 9 of 11 menu items **by design** — this is working RBAC, not a missing feature. Verified across all 48 frontend components and full git history: **no menu item or component was ever removed.**

## 8. Redis / Events, Failure Isolation, Backup/Restore

**Redis** — publish delivered to 1 live subscriber. *Documented limitation:* events published while a consumer is down are **lost**; Redis pub/sub has no durability, so realtime events must not be treated as a system of record.

**Failure isolation** — analytics-service stopped → `/api/analytics/dashboard` **502**, `/api/jobs` **200**, `/api/candidate-jobs` **200**; restored → **200**. No cascade, and the monolith did not reappear.

**Backup/restore** — `tejoma_matching_scoring` (1628 lines) restored into a disposable DB: 4/4 tables identical, all row counts matched. Disposable dropped. Earlier runs verified `tejoma_candidate`, `tejoma_matching_decision`, `tejoma_matching_evaluation`, and the monolith's own database.

## 9. Final Dependency Scan

**Runtime:** no service holds a non-empty monolith URL. Zero services log a monolith call *attempt* other than the class-B mirrors below.

| Class | Locations | Evidence |
|---|---|---|
| **A — business-critical** | **NONE** | — |
| **B — rollback-only, fire-and-forget** | job-service `mirrorAndNotifyJobCreate/Update/Delete`; matching-decision-service `mirrorAndNotifySwipe`; candidate-core-service mirror writes | Log `"Failed to mirror … will be stale"` while the **same requests returned 201**. Non-blocking, proven. |
| **B — flag-gated, real path verified** | matching-decision-service `getRecruiterReviewList` | `/api/recruiter-review` **200** |
| **E — dead code** | `candidate-service/routes/candidateAnalytics/index.routes.ts` (not mounted); `chat-service` `getPlatformStats` (calls candidate-core + job-service despite the filename); `matching-decision-service/src/routes/internal/*.ts`; unused `monolithClient` exports in matching-evaluation/scoring | No runtime effect |
| **D — config/type declarations** | `*/config/env.ts`, `chat-service/types.ts` | Declarations only |

**Docker:** `app` is not a compose service; `docker compose config --services` does not list it; zero `depends_on: app` remain (12 removed earlier); no `app:3006` outside explanatory comments.

## 10. Preserved for Rollback — NOT Deleted

Per instruction, historical source and rollback material remain:

- all monolith source under `src/`
- each service's `services/monolithClient.ts` (class B/E, proven non-blocking)
- `.env.local` monolith vars, commented with rollback instructions
- `docker-compose.yml.pre-decommission`, `.env.local.pre-decommission`
- git tags `pre-monolith-decommission` (`aa8584d`) and `monolith-decommissioned`
- `.decommission-backup/` — 14 database dumps, **on disk, gitignored** (they contain real user emails and names and were removed from git tracking after an over-broad `git add -A` staged them)

## 11. Rollback Procedure

1. `git checkout pre-monolith-decommission -- docker-compose.yml .env.local` (or restore the `.pre-decommission` copies).
2. Uncomment `MONOLITH_INTERNAL_URL` in `.env.local`; set `MONOLITH_FALLBACK_ENABLED=true`.
3. `docker compose up -d app` — the image is still built locally.
4. `docker compose up -d` to recreate services with the monolith URLs restored.
5. If database rollback is needed: restore from `.decommission-backup/*.sql` (verified restorable, §2 step 3).

The fallback branch in `proxy.ts` and every `monolithClient` are unchanged, so rollback is configuration-only.

## 12. Remaining Risks (none blocking)

1. **Realtime events are lossy** during consumer downtime (§8).
2. **`knowledge_base_chunks` missing** in `tejoma_candidate_core` — candidate RAG indexing silently no-ops (fire-and-forget).
3. **Silent degradation** — with job-service stopped, `GET /api/candidate-jobs` returns `200 {"jobs":[]}` rather than 503; a candidate sees "no jobs" instead of an error.
4. **`nanoid` advisory** (GHSA-2v37-7h3g-55p8, transitive) in candidate-core-service.
5. **`companies` unreconciled** — 19 rows in `tejoma_recruiting` vs 18 in tenant-directory-service. `tejoma_recruiting` should be retained as cold storage ≥30 days.
6. **Recurring defect classes** across this migration, worth a standing lint rule: missing keys on exported `db` objects (**5 occurrences**), SQL referencing nonexistent columns, undeclared npm imports, unmounted routers, `catch → return []` masking failures, and stale Docker images hiding correct source. `upload-service` and `notifications-service` were never exercised and warrant the same sweep.

## 13. Recommended Next Steps

1. Monitor 48h. Nothing should require the monolith; if something does, §11 restores it in minutes.
2. After a stable period, delete `src/` monolith source and each service's `monolithClient.ts` (all class B/E).
3. Retain `tejoma_recruiting` as cold storage ≥30 days (§12.5), then archive.
4. Move `.decommission-backup/` to secure storage — it contains real user data.

---

## 14. Why This Verdict

The rule required zero business-critical monolith dependencies, complete workflows working with the monolith gone, ML dependencies resolved, auth/RBAC/tenant isolation verified, data consistency verified, Redis/events working as designed, backup/restore verified, failure isolation verified, Docker unable to restart the monolith, and runtime evidence throughout.

**Every condition is met with runtime evidence gathered while the monolith container did not exist** — not merely stopped. The monolith is now a rollback artifact on disk and in git history, with no runtime presence.

**PRODUCTION READY — MONOLITH DECOMMISSIONED**
