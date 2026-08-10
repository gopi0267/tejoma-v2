# Complete Architectural Audit Report
## Tejoma AI Recruiting Platform - Monolith to Microservices

**Date**: 2026-08-06  
**Status**: Partial extraction complete (21/45 services), 38 monolith routes remain

---

## Executive Summary

### Extraction Progress
- **Services Extracted**: 21
- **Routes Migrated**: ~52 (internal endpoints + public APIs)
- **Routes Remaining in Monolith**: 38
- **Estimated Migration Completion**: 60% complete

### Key Statistics
| Metric | Count | Status |
|--------|-------|--------|
| Microservices | 21 | ✅ Extracted |
| Monolith Routes | 38 | ⚠️ Remaining |
| Databases | 21+ separate DBs | ✅ Isolated |
| Dual-write Hooks | 15+ | ✅ In place |
| Feature Flags | 5+ | ✅ Active |
| Backfill Scripts | 8+ | ✅ Created |
| Validation Scripts | 8+ | ✅ Created |

---

## Monolith Route Analysis

### Already Extracted (Service Exists, Route May Still Proxy)

#### Tier 0 Services (Domain Core)
| Route | Service | Status | DB | Notes |
|-------|---------|--------|-----|-------|
| candidate-core-internal | candidate-core-service | ✅ Extracted | tejoma_candidate_core | Owns `candidates` table |
| candidate-internal | candidate-service | ✅ Extracted | tejoma_candidate | Owns `candidate_accounts`, `candidate_experiences` |
| candidate-search-internal | candidate-service | ✅ Extracted | tejoma_candidate | Item 2: Shortlisted tab cutover complete |
| chat-internal | chat-service | ✅ Extracted | tejoma_chat | Owns `chat_messages`, `chat_rooms` |
| job-internal | job-service | ✅ Extracted | tejoma_job | Owns `jobs` table |
| matching-decision-internal | matching-decision-service | ✅ Extracted | tejoma_matching_decision | Owns `swipes`, `recruiter_notes`, `recruiter_review_view` (Item 5 CQRS) |
| matching-evaluation-internal | matching-evaluation-service | ✅ Extracted | tejoma_matching_evaluation | Owns `match_evaluation_runs`, `ltr_model_versions` |
| matching-scoring-internal | matching-scoring-service | ✅ Extracted | tejoma_matching_scoring | Owns `match_features` |
| recruiting-internal | recruiting-service | ✅ Extracted | tejoma_recruiting | Owns `recruiter_notifications` |
| resume-internal | resume-service | ⚠️ Partial | None | Routes exist but no DB |
| skill-discovery-internal | matching-skill-discovery-service | ✅ Extracted | tejoma_matching_skill_discovery | Owns `skill_nodes` mirror |

#### Tier 1-3 Services (Supporting/Analytics)
| Route | Service | Status | DB | Notes |
|--------|---------|--------|-----|--------|
| analytics-internal | analytics-service | ✅ Extracted | tejoma_analytics | Owns `analytics_events`, reporting tables |
| career-intelligence-service | career-intelligence-service | ✅ Extracted | tejoma_career_intelligence | Owns `career_trajectories` |
| dynamic-weighting-service | dynamic-weighting-service | ✅ Extracted | tejoma_dynamic_weighting | Owns `weighting_profiles` |
| identity-service | identity-service | ✅ Extracted | tejoma_identity | Owns `users`, `refresh_tokens`, `password_history` |
| jd-parser-service | jd-parser-service | ✅ Extracted | None | Stateless parser service |
| matching-reasoning-service | matching-reasoning-service | ✅ Extracted | tejoma_matching_reasoning | Owns `skill_nodes`, `skill_edges`, `reasoning_conclusions` |
| platform-governance-service | platform-governance-service | ✅ Extracted | tejoma_platform_governance | Owns `companies`, `permissions`, `audit_logs` |
| role-intelligence-service | role-intelligence-service | ✅ Extracted | tejoma_role_intelligence | Owns `role_profiles` |
| tenant-directory-service | tenant-directory-service | ✅ Extracted | tejoma_tenant_directory | Owns `tenant_configs`, `tenant_settings` |

### Still in Monolith (Must Extract)

#### Public/API Routes

**Authentication & Identity**
```
auth.routes.ts                  → identity-service (public routes)
candidate-auth.routes.ts        → identity-service (candidate self-service auth)
users.routes.ts                 → identity-service (admin user management)
```

**Candidate Domain**
```
candidate.routes.ts             → candidate-core-service (public GET, but POST/PUT/DELETE?)
candidate-profile.routes.ts     → candidate-service (profile read/write)
candidate-resume.routes.ts      → candidate-service (resume upload/management)
candidate-jobs.routes.ts        → candidate-service (job discovery, matches)
candidate-decisions.routes.ts   → matching-decision-service or candidate-service (swipe history)
candidate-applications.routes.ts → candidate-service (application state management)
candidate-matches.routes.ts     → candidate-service (mutual matches, match history)
candidate-analytics.routes.ts   → candidate-service (Item 4: Dashboard analytics) [PARTIALLY DONE]
candidate-notifications.routes.ts → notifications-service (WebSocket + state)
```

**Recruiter Domain**
```
recruiter-review.routes.ts      → matching-decision-service (Item 3 & 5: Detail & list)
recruiter-matches.routes.ts     → recruiting-service (candidate discovery)
recruiter-notifications.routes.ts → notifications-service (WebSocket + state)
```

**Job Management**
```
job.routes.ts                   → job-service (GET list/detail done, POST/PUT/DELETE?)
company-requests.routes.ts      → recruiting-service or platform-governance (company lifecycle)
```

**AI/ML Operations**
```
ml.routes.ts                    → matching-evaluation-service (model training, evaluation)
skill-intelligence.routes.ts    → matching-reasoning-service (skill graph operations)
proficiency-analytics.routes.ts → analytics-service or candidate-service (skill proficiency)
jd-parser.routes.ts             → jd-parser-service (public parser endpoint)
chat.routes.ts                  → chat-service (Chat/RAG endpoint)
```

**Utility Routes**
```
upload.routes.ts                → upload-service (NEW: file storage + resume extraction)
swipe.routes.ts                 → matching-decision-service (swipe recording) [ITEM 1]
health.routes.ts                → api-gateway (health checks)
```

#### Internal/Shadow Routes (May Be Deprecated)

```
analytics-internal.routes.ts         → analytics-service
candidate-notifications (internal)   → notifications-service  
recruiter-notifications (internal)   → notifications-service
resume-internal.routes.ts            → resume-service
skill-discovery-internal.routes.ts   → matching-skill-discovery-service
```

---

## Database Ownership Map

### Tier 0 Services (User-Facing Databases)

```
tejoma_candidate_core
├── candidates                  (Read: candidate-core-service, Write: candidate-core-service + monolith dual-write)
├── candidate_resume_raw        (New: resume-service, Write: resume-service)
├── candidate_resume_parsed     (New: resume-service)
└── Indexes: candidate_account_id (NEW, for analytics cross-service lookup)

tejoma_candidate
├── candidate_accounts          (Write: candidate-service, Read: all)
├── candidate_experiences       (Write: candidate-service, Read: all)
├── candidate_profile_views     (Write: candidate-service, Read: recruiting-service)
├── candidate_notifications    (Write: candidate-service, Dual-write mirror from monolith)
├── saved_candidates            (Write: recruiting-service, Read: recruiting-service)
├── candidate_profile_views     (Write: recruiting-service, Read: candidate-service)
│
│ Item 4 Tables (Dual-written from monolith):
├── candidate_decisions         (Mirror from monolith swipes → decision_type mapping)
├── candidate_application_status (Mirror from monolith applications table)
└── mutual_matches              (Mirror from monolith mutual_matches)

tejoma_job
├── jobs                        (Write: job-service, Read: all)
├── job_posting_requirements    (Write: job-service, Read: matching-scoring-service)
└── job_posting_benefits        (Write: job-service)

tejoma_matching_decision
├── swipes                      (Write: matching-decision-service + Phase C cutover)
├── recruiter_notes             (Write: matching-decision-service)
├── detailed_scoring_reports    (Write: matching-decision-service)
│
│ Item 5 CQRS Table:
└── recruiter_review_view       (Materialized view: refresh on swipe/note/recruiter changes)

tejoma_identity
├── users                       (Write: identity-service, Read: all)
├── refresh_tokens              (Write: identity-service)
└── password_history            (Write: identity-service)
```

### Tier 1-3 Services (Supporting Databases)

```
tejoma_chat
└── chat_messages, chat_rooms   (Write: chat-service)

tejoma_matching_evaluation
├── match_evaluation_runs       (Write: matching-evaluation-service)
└── ltr_model_versions          (Write: matching-evaluation-service)

tejoma_matching_scoring
└── match_features              (Write: matching-scoring-service)

tejoma_matching_reasoning
├── skill_nodes                 (Mirror to: skill-discovery-service, evaluation-service)
├── skill_edges                 (Write: matching-reasoning-service)
└── reasoning_conclusions       (Write: matching-reasoning-service)

tejoma_matching_skill_discovery
└── skill_nodes                 (Mirror from reasoning-service)

tejoma_analytics
└── (Multiple analytics tables, reporting only)

tejoma_career_intelligence
└── career_trajectories         (Write: career-intelligence-service)

tejoma_role_intelligence
└── role_profiles               (Mirror to: multiple services)

tejoma_platform_governance
├── companies                   (Write: platform-governance-service)
├── company_permissions         (Write: platform-governance-service)
└── audit_logs                  (Write: all services)

tejoma_tenant_directory
└── tenant_configs              (Write: tenant-directory-service)

tejoma_dynamic_weighting
└── weighting_profiles          (Write: dynamic-weighting-service)
```

### Monolith DB (tejoma) - Legacy Tables (Read-Only, Dual-Write Targets)

These tables remain in monolith but are mirrored to other services:
- `candidates` → candidate-core-service (read-only in monolith now)
- `swipes` → matching-decision-service (read-only in monolith, write to both)
- `jobs` → job-service (read-only in monolith, write to both)
- `users` → identity-service (read-only in monolith, write to both)
- `recruiter_notes` → matching-decision-service (read-only)
- `candidate_accounts` → candidate-service (read-only)
- `career_trajectories` → career-intelligence-service (read-only, used by explainability)
- `reasoning_conclusions` → matching-reasoning-service (read-only)
- `skill_nodes` → matching-skill-discovery-service + matching-reasoning-service (read-only)

**Note**: Monolith tables are never deleted. They remain as permanent rollback targets.

---

## Dependency Graph (Critical Path Analysis)

### Tier 0: Foundational Services (Must Extract First)

```
┌─────────────────────────────────────────────────────┐
│ identity-service (Users, Auth, Permissions)         │
└──────────────────┬──────────────────────────────────┘
                   │ All services depend on auth
                   ▼
┌─────────────────────────────────────────────────────┐
│ platform-governance-service (Companies, RBAC)       │
└──────────────────┬──────────────────────────────────┘
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
    ┌────────┐ ┌────────┐ ┌──────────────────┐
    │ Job    │ │Candidate│ │Upload / Resume   │
    │Service │ │Service  │ │Service (NEW)     │
    └────────┘ └────────┘ └──────────────────┘
         │         │              │
         └────┬────┴──────────────┘
              ▼
   ┌──────────────────────────┐
   │ Matching Services Cluster│
   │ (Decision, Scoring,      │
   │  Reasoning, Evaluation)  │
   └──────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────────────┐
│Analytics│ │Notifications   │
│Service  │ │Service (NEW)   │
└────────┘ └────────────────┘
```

### Hidden Dependencies (Must Address)

1. **Resume Processing Pipeline**
   - Upload route → resume extraction → candidate profile update
   - Currently: monolith-only
   - Need: upload-service → resume-service → candidate-service dual-write

2. **Real-time Notifications**
   - WebSocket handlers scattered across multiple routes
   - Socket.io connections in: recruiter-notifications, candidate-notifications, chat
   - Currently: monolith socket server
   - Need: notifications-service with socket.io, pub/sub from all services

3. **Candidate Analytics (Item 4)**
   - Reads from: candidate_decisions, candidate_application_status, mutual_matches (mirrors)
   - Computes: match scores, funnel, skill demand, salary insights
   - Route exists but orchestration incomplete
   - Need: Complete candidate-service analytics orchestration

4. **Recruiter Review List (Item 5)**
   - Requires materialized view across 4 services
   - Route exists with cutover flag, but view refresh hooks incomplete
   - Need: Complete cross-service refresh hook integration

5. **ML Model Training**
   - ml.routes.ts orchestrates Python worker via BullMQ
   - Needs: matching-evaluation-service ownership
   - Python worker: python-services/matching-ml-service (already exists)

6. **Skill Graph Management**
   - skill-intelligence.routes.ts manages skill_nodes, skill_edges
   - Multiple services read (reasoning, discovery, evaluation)
   - Dual mirrors to multiple services
   - Need: Complete skill-reasoning-service ownership, deprecate monolith routes

---

## Shared Code Analysis

### Ported Code (No Duplication)

- ✅ `computeMatchFeatures`, `computeFeatureScore` (candidate-service/matching/services.ts)
- ✅ `parseExperienceYears`, `resolveCandidateSalaryExpectation` (candidate-service/matching/parseCandidateFields.ts)
- ✅ Explainability module (matching-decision-service/matching/explainability/)
- ✅ Career sequence inference (matching-decision-service/matching/careerIntelligence/)
- ✅ Skill proficiency computation (matching-decision-service/matching/skillProficiency.ts)

### Code Reuse Opportunities

| Module | Location | Reuse? | Notes |
|--------|----------|--------|-------|
| Password validation | src/utils/password.ts | ✅ Identity-service | Shared with identity-service |
| Email validation | src/utils/validation.ts | ✅ All services | Could extract to shared lib |
| Token signing | src/utils/tokens.ts | ✅ Identity-service | Already extracted |
| Logger | src/utils/logger.ts | ✅ Pino shared | Already in all services |
| DB pool creation | src/db.ts | ⚠️ Duplicate | Each service reimplements (acceptable) |
| Middleware auth | src/middleware/auth.middleware.ts | ✅ JWT validation shared | In every service |
| RBAC middleware | (new) | ✅ Platform-governance | Not yet extracted |
| Error handling | src/utils/errors.ts | ⚠️ Partial | Each service has custom classes |
| Request validation | src/api/validation/ | ⚠️ Duplicate | Zod schemas repeated in services |

### Libraries to Extract (Not Yet)

```
packages/
├── shared-types/           → DTOs, interfaces, enums
├── shared-validation/      → Zod schemas, validation functions
├── shared-utils/           → Utilities, helpers
├── shared-middleware/      → Auth, RBAC, logging, correlation IDs
├── shared-errors/          → Custom error classes
└── shared-db/              → Migration helpers, pool creation
```

---

## Remaining Work Priority Matrix

### Critical Path (Blocks Everything)

| Item | Service | Est. Hours | Dependency | Notes |
|------|---------|-----------|------------|-------|
| 1. Complete identity-service auth routes | identity-service | 16h | None | All services depend on this |
| 2. Upload & Resume service (NEW) | upload-service + resume-service | 24h | identity-service | Blocks candidate profile |
| 3. Notifications service (NEW) | notifications-service | 20h | identity-service | Blocks real-time features |

### High Priority (Revenue Path)

| Item | Service | Est. Hours | Dependency | Notes |
|------|---------|-----------|------------|-------|
| 4. Candidate decisions & applications | candidate-service | 20h | Upload, Notifications |
| 5. Candidate job discovery | candidate-service | 16h | Notifications |
| 6. Candidate profile cutover | candidate-service | 12h | Upload, Resume |
| 7. Recruiter match discovery | recruiting-service | 16h | Notifications |

### Medium Priority (Operational)

| Item | Service | Est. Hours | Dependency | Notes |
|------|---------|-----------|------------|-------|
| 8. ML model training | matching-evaluation-service | 12h | Identity |
| 9. Skills graph completion | matching-reasoning-service | 12h | Skill discovery |
| 10. Analytics completion | analytics-service | 16h | All read services |
| 11. Chat completion | chat-service | 8h | Notifications |

### Lower Priority (Admin/Config)

| Item | Service | Est. Hours | Dependency | Notes |
|------|---------|-----------|------------|-------|
| 12. Company operations | recruiting-service | 8h | Identity, Platform-governance |
| 13. JD Parser routing | jd-parser-service | 4h | Identity |

---

## Risk Assessment

### High Risk Items

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Real-time notification loss | Customer experience | Dual-write WebSocket + fallback polling |
| Resume extraction failure | Customer profile data loss | Upload → temp storage → async extraction → rollback on failure |
| Circular dependencies in refresh hooks | Data inconsistency | Implement change data capture pattern, not cascade hooks |
| ML training service unavailability | No new model versions | Keep monolith trainer running as fallback |

### Medium Risk Items

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Database migration failures | Data corruption | Backfill + validation scripts, dry-run on staging |
| Feature flag complexity | Operational confusion | Automated flag audit, max 10 active flags |
| Cross-service network issues | Cascading failures | Circuit breakers, retry policies, fallback to monolith |

---

## Production Readiness Checklist Template

For each extracted service/route:

- [ ] Database schema created and migrated
- [ ] Dual-write hooks implemented (if existing monolith writes)
- [ ] Backfill script created and tested
- [ ] Validation script shows zero drift for 48h
- [ ] Feature flag created (default: false/monolith)
- [ ] Internal APIs created and tested
- [ ] Unit tests pass (>80% coverage)
- [ ] Integration tests with dependencies pass
- [ ] A/B parity test: old vs. new response deep-equal
- [ ] Full-path test: nginx → gateway → service → DB
- [ ] Load test: 1000 req/s, p99 latency <500ms
- [ ] Monitoring: latency histogram, error rate, queue depth
- [ ] Structured logging with correlation IDs
- [ ] Rollback tested: flip flag, verify fallback works
- [ ] Documentation: architecture, troubleshooting, runbook
- [ ] On-call playbook created
- [ ] Canary deployment verified (if applicable)
- [ ] Blue-green deployment readiness verified

---

## Next Steps

**Phase 1 (This week)**
1. Complete identity-service auth route extraction (if not done)
2. Create upload-service + resume-service
3. Create notifications-service architecture

**Phase 2 (Next 1-2 weeks)**
1. Implement notifications-service with socket.io + pub/sub
2. Complete candidate profile cutover
3. Complete candidate decisions & applications

**Phase 3 (Following week)**
1. Recruiter match discovery
2. ML model training service cutover
3. Analytics completion

---

## Existing Assets Ready for Reuse

✅ Dual-write pattern (dualWrite.ts already established)
✅ Backfill/validation scripts (templates created)
✅ Feature flag pattern (ITEM_X_CUTOVER_ENABLED)
✅ Materialized view pattern (recruiter_review_view example)
✅ Cross-service HTTP client pattern (established)
✅ Fire-and-forget error handling (non-fatal upstream calls)
✅ Cutover testing pattern (parity A/B tests)
✅ Monitoring/metrics pattern (upstreamProxy* metrics)

---

## Questions Before Implementation

1. **Notifications**: Should we use Socket.io, WebSocket API Gateway, or Server-Sent Events (SSE)?
2. **Resume Processing**: Synchronous or async via job queue?
3. **Analytics**: Can we defer proficiency analytics (lower priority)?
4. **ML Training**: Keep monolith trainer as fallback or migrate completely?
5. **Skill Graph**: Should we consolidate to reasoning-service or keep dual-service?

---

**Report Generated**: Complete architectural audit ready for implementation planning.
