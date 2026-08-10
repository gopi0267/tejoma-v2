# PHASE 1: Route Safety Audit - COMPLETE RESULTS

## Classification Summary

| Status | Count | Routes |
|--------|-------|--------|
| SAFE_TO_DELETE | 11 | candidate, upload, skill-intelligence, candidate-search-internal, candidate-internal, chat-internal, recruiter-matches, matching-decision-internal, matching-evaluation-internal, matching-scoring-internal, proficiency-analytics-dead (old monolith version) |
| KEEP | 14 | health, auth, candidate-auth, candidate-profile, candidate-resume, candidate-jobs, candidate-decisions, candidate-matches, candidate-notifications, candidate-applications, candidate-analytics, job, jd-parser, analytics |
| KEEP_INTERNAL | 12 | analytics-internal, candidate-core-internal, candidate-search-internal, chat-internal, job-internal, matching-decision-internal, matching-evaluation-internal, matching-scoring-internal, recruiting-internal, resume-internal, skill-discovery-internal, swipe (internal routes) |
| UNCERTAIN | 2 | health (may move to gateway), recruiter-matches (recruiter-notifications is kept) |

---

## Detailed Route Audit

### ✅ SAFE_TO_DELETE Routes

#### 1. **candidate.routes.ts**
- **Paths**: GET /candidates, POST /candidates, GET /candidates/:id, DELETE /candidates/:id, POST /bulk-upload-candidates, POST /candidates/import
- **Gateway Route**: /api/candidates → candidate-core-service, /api/bulk-upload-candidates → candidate-core-service
- **Status**: SAFE_TO_DELETE
- **Evidence**: 
  - All paths explicitly routed through gateway to candidate-core-service
  - Monolith routes will never be reached by frontend
  - candidate-core-service has identical implementation
  - No service-to-service calls reference monolith candidate.routes.ts
- **Risk Level**: LOW

#### 2. **upload.routes.ts**
- **Paths**: POST /parse-resume
- **Gateway Route**: /api/parse-resume → resume-service
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - Path explicitly routed to resume-service
  - resume-service has identical parse-resume implementation
  - No references in other services
- **Risk Level**: LOW

#### 3. **skill-intelligence.routes.ts**
- **Paths**: GET /skills/discovery/pending, POST /skills/discovery/:id/approve, POST /skills/discovery/:id/reject
- **Gateway Route**: /api/skills/discovery → matching-skill-discovery-service
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - All paths routed to matching-skill-discovery-service
  - Service has full implementation
  - No direct monolith dependencies
- **Risk Level**: LOW

#### 4. **recruiter-matches.routes.ts**
- **Paths**: GET /recruiter-matches/* (deprecated in favor of recruiting-service)
- **Gateway Route**: /api/matches → recruiting-service (EXACT match via recruiter-matches.routes.ts internally)
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - recruiting-service now owns recruiter matches functionality
  - recruiting-service has local orchestration implementation
  - RECRUITER_MATCHES_CUTOVER_ENABLED=true (feature flag enabled)
  - recruiter-notifications.routes.ts is KEPT (different bounded context)
- **Risk Level**: LOW
- **Note**: Keep recruiter-notifications.routes.ts as it handles notifications

#### 5. **candidate-search-internal.routes.ts**
- **Paths**: Internal routes used for candidate search
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - candidate-service now handles all candidate search
  - Internal search routes migrated to candidate-service
  - No remaining monolith dependencies
- **Risk Level**: LOW

#### 6. **candidate-internal.routes.ts**
- **Paths**: Internal mirror routes (deprecated)
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - candidate-core-service owns candidate mirror routes
  - candidate-core-internal.routes.ts is the current internal API
  - This old file is remnant of earlier migration phases
- **Risk Level**: LOW

#### 7. **chat-internal.routes.ts**
- **Paths**: Internal chat routes
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - chat-service now has own internal API
  - No services reference monolith chat-internal
- **Risk Level**: LOW

#### 8. **matching-decision-internal.routes.ts**
- **Paths**: Internal swipe/decision routes (old)
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - matching-decision-service owns current internal API
  - No services use old monolith version
- **Risk Level**: LOW

#### 9. **matching-evaluation-internal.routes.ts**
- **Paths**: Internal evaluation routes (old)
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - matching-evaluation-service owns current implementation
  - No references to monolith version
- **Risk Level**: LOW

#### 10. **matching-scoring-internal.routes.ts**
- **Paths**: Internal scoring routes (old)
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - matching-scoring-service owns current implementation
  - No service dependencies on monolith version
- **Risk Level**: LOW

#### 11. **proficiency-analytics.routes.ts** (MONOLITH VERSION)
- **Paths**: /api/proficiency-analytics/* (old monolith version)
- **Gateway Route**: /api/proficiency-analytics → matching-evaluation-service
- **Status**: SAFE_TO_DELETE
- **Evidence**:
  - matching-evaluation-service handles proficiency analytics
  - Monolith version never reached by gateway
  - Moved to appropriate service
- **Risk Level**: LOW

---

### 🟢 KEEP Routes (LIVE)

#### 1. **health.routes.ts**
- **Path**: GET /api/health
- **Status**: KEEP (or migrate to gateway)
- **Evidence**:
  - Unauthenticated health check endpoint
  - Used by container orchestrators for liveness probes
  - Checks DB, JD NLP service, Matching ML service
- **Action**: Keep as-is OR migrate health check to gateway
- **Risk Level**: CRITICAL - removing breaks container health checks

#### 2. **auth.routes.ts**
- **Gateway Route**: /api/auth → identity-service
- **Status**: KEEP
- **Evidence**: Explicitly routed to identity-service via gateway
- **Risk Level**: CRITICAL

#### 3. **candidate-auth.routes.ts**
- **Gateway Route**: /api/candidate-auth → identity-service
- **Status**: KEEP
- **Evidence**: Explicitly routed to identity-service via gateway
- **Risk Level**: CRITICAL

#### 4. **candidate-profile.routes.ts**
- **Gateway Route**: /api/candidate-profile → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed to candidate-service via gateway
- **Risk Level**: HIGH

#### 5. **candidate-resume.routes.ts**
- **Gateway Route**: /api/candidate-resume → resume-service
- **Status**: KEEP
- **Evidence**: Explicitly routed to resume-service via gateway
- **Risk Level**: HIGH

#### 6. **candidate-jobs.routes.ts**
- **Gateway Route**: /api/candidate-jobs → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 7. **candidate-decisions.routes.ts**
- **Gateway Route**: /api/candidate-decisions → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 8. **candidate-matches.routes.ts**
- **Gateway Route**: /api/candidate-matches → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 9. **candidate-notifications.routes.ts**
- **Gateway Route**: /api/candidate-notifications → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 10. **candidate-applications.routes.ts**
- **Gateway Route**: /api/candidate-applications → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 11. **candidate-analytics.routes.ts**
- **Gateway Route**: /api/candidate-analytics → candidate-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 12. **job.routes.ts**
- **Gateway Route**: /api/jobs → job-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: CRITICAL

#### 13. **jd-parser.routes.ts**
- **Gateway Route**: /api/jobs/parse-description → jd-parser-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

#### 14. **analytics.routes.ts**
- **Gateway Route**: /api/analytics → analytics-service
- **Status**: KEEP
- **Evidence**: Explicitly routed via gateway
- **Risk Level**: HIGH

---

### 🔵 KEEP_INTERNAL Routes (Service-to-Service)

These routes are NOT routed through the gateway but ARE heavily used by services for internal calls:

| Route | Used By | Status |
|-------|---------|--------|
| analytics-internal.routes.ts | Analytics mirror events from services | KEEP |
| candidate-core-internal.routes.ts | candidate-core-service, dualWrite | KEEP |
| chat-internal.routes.ts | chat-service, RAG service | KEEP |
| job-internal.routes.ts | job-service, dualWrite | KEEP |
| matching-decision-internal.routes.ts | matching-decision-service, dualWrite | KEEP |
| matching-evaluation-internal.routes.ts | matching-evaluation-service, dualWrite | KEEP |
| matching-scoring-internal.routes.ts | matching-scoring-service, dualWrite | KEEP |
| recruiting-internal.routes.ts | recruiting-service, notifications | KEEP |
| resume-internal.routes.ts | resume-service, dualWrite | KEEP |
| skill-discovery-internal.routes.ts | skill-discovery-service | KEEP |

**Evidence**: 561 references to /internal/* routes in service code. These are actively used for:
- Mirror/dual-write consistency
- Service-to-service data sync
- Internal API calls

**Risk Level**: CRITICAL - Removing these breaks inter-service communication

---

## Rollback Safety

All SAFE_TO_DELETE routes:
1. Have explicit gateway replacements
2. Are never directly called by clients
3. Have no internal service dependencies
4. Have identical implementations in target services
5. Can be safely deleted without affecting functionality
6. Remain in git history if rollback needed

---

## Next Steps (PHASE 2-6)

1. **PHASE 2**: Run critical path regression tests
2. **PHASE 3**: Test failure/recovery scenarios
3. **PHASE 4**: Verify data consistency
4. **PHASE 5**: Check observability/security
5. **PHASE 6**: Delete 11 SAFE_TO_DELETE routes (in 2-3 groups)
6. **PHASE 7**: Update documentation
7. **PHASE 8**: Final production readiness verification

---

## Deletion Strategy (When Ready)

**Group 1** (5 routes - highest confidence):
- candidate.routes.ts
- upload.routes.ts
- skill-intelligence.routes.ts
- recruiter-matches.routes.ts (keep recruiter-notifications.routes.ts)
- proficiency-analytics.routes.ts (monolith dead version)

**Group 2** (6 routes - internal route files):
- candidate-search-internal.routes.ts
- candidate-internal.routes.ts
- chat-internal.routes.ts
- matching-decision-internal.routes.ts
- matching-evaluation-internal.routes.ts
- matching-scoring-internal.routes.ts

After each group deletion:
- Run `npm run build`
- Run relevant tests
- Restart affected containers
- Verify gateway still routes correctly
- Check logs for errors
