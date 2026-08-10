# Remaining Monolith Extraction Roadmap
## Advanced Production Level Microservices Migration

**Current State**: 21 services extracted, ~38 route files remaining in monolith

---

## Phase 1: Critical Path (High Impact, Lower Complexity)
*Estimated: 2-3 weeks*

### 1.1 Upload & Resume Processing Service
**Routes**: `upload.routes.ts`, `resume-internal.routes.ts`, `candidate-resume.routes.ts`
**Impact**: File handling is blocking, needed by multiple services
**Approach**: New `upload-service`, pure file storage + resume extraction
**Dependencies**: None (stands alone)

### 1.2 Company & Admin Operations Service  
**Routes**: `company-requests.routes.ts`
**Impact**: Admin workflows, company lifecycle
**Approach**: Extend `platform-governance-service` or new `company-service`
**Dependencies**: Identity Service (users)

### 1.3 Real-time Notifications Extraction
**Routes**: `recruiter-notifications.routes.ts`, `candidate-notifications.routes.ts`
**Status**: Partially done (candidate-service owns candidate_notifications table)
**Approach**: Move WebSocket handlers + socket.io to new `notifications-service`
**Dependencies**: All services with notifications (candidate-service, recruiting-service, matching-decision-service)

---

## Phase 2: Candidate-Facing Operations (Medium Impact)
*Estimated: 3-4 weeks*

### 2.1 Candidate Decisions & Applications
**Routes**: `candidate-decisions.routes.ts`, `candidate-applications.routes.ts`
**Status**: Already partially extracted (matching-decision-service owns swipes)
**Approach**: Complete cutover to candidate-service (own routes for application state)
**Dual-write targets**: candidate-service tables (candidate_application_status, candidate_decisions - already mirrored)

### 2.2 Candidate Job Discovery
**Routes**: `candidate-jobs.routes.ts`
**Impact**: Candidate-facing job browsing, matching discovery
**Approach**: New routes in candidate-service, fan-out to job-service + matching-scoring-service
**CQRS**: Materialized recommendations view (similar to Item 5's recruiter-review-view)

### 2.3 Candidate Matches & History
**Routes**: `candidate-matches.routes.ts`
**Impact**: Candidate's match history, mutual match details
**Approach**: Candidate-service owns this, queries matching-decision-service + job-service
**Schema**: Reuse mutual_matches mirror from candidate-service analytics tables

---

## Phase 3: Recruiter-Facing Operations (Medium Impact)
*Estimated: 3-4 weeks*

### 3.1 Recruiter Match Discovery
**Routes**: `recruiter-matches.routes.ts`
**Impact**: Recruiter's candidate discovery, manual search
**Approach**: Fan-out to candidate-core-service + matching-scoring-service
**Search**: Leverage pg_trgm GIN indexes from Item 5's recruiter-review-view pattern

### 3.2 Skills & Proficiency Management
**Routes**: `skill-intelligence.routes.ts`, `proficiency-analytics.routes.ts`
**Status**: skill-discovery-service partially owns this
**Approach**: Complete extraction to matching-reasoning-service + matching-skill-discovery-service
**Dual-write**: Mirror to matching-evaluation-service (already gets skill_nodes)

---

## Phase 4: ML & Analytics Operations (Lower Impact, Higher Complexity)
*Estimated: 4-6 weeks*

### 4.1 ML Model Training & Evaluation
**Routes**: `ml.routes.ts`
**Status**: matching-evaluation-service owns evaluation runs
**Approach**: Extend matching-evaluation-service with training orchestration
**Schema**: Reuse ltr_model_versions, match_evaluation_runs tables
**Cutover**: Trainer service (Python via BullMQ queue) already exists

### 4.2 Analytics & Reporting
**Routes**: `analytics.routes.ts`, `analytics-internal.routes.ts`
**Impact**: Business metrics, funnel analytics
**Approach**: analytics-service owns this, orchestrates candidate-service + recruiting-service
**CQRS**: Materialized analytics views in analytics-service DB

### 4.3 JD Parser Operations
**Routes**: `jd-parser.routes.ts`
**Status**: jd-parser-service already extracted
**Approach**: Move monolith routes to jd-parser-service (already owns the logic)

---

## Phase 5: Chat & Support (Lower Impact)
*Estimated: 1-2 weeks*

### 5.1 Chat Service Completion
**Routes**: `chat.routes.ts`, `chat-internal.routes.ts`
**Status**: chat-service partially extracted
**Approach**: Complete cutover, WebSocket handlers via notifications-service
**Dual-write**: RAG/embedding indexing to matching-reasoning-service

---

## Phase 6: Identity & Auth Completion (Medium Complexity)
*Estimated: 2-3 weeks*

### 6.1 Auth Routes Full Migration
**Routes**: `auth.routes.ts`, `candidate-auth.routes.ts`
**Status**: identity-service extracted, but monolith routes may still exist
**Approach**: Complete move of all auth to identity-service
**Cutover**: All auth flows → identity-service only (no fallback)

### 6.2 User Management
**Routes**: `users.routes.ts`
**Status**: identity-service owns users
**Approach**: Verify all write paths point to identity-service
**Dual-write**: From recruiting-service + any admin operation

---

## Phase 7: Data Consistency Layer (Critical)
*Estimated: 2 weeks, can run in parallel with Phases 1-6*

### 7.1 Shadow Service Consolidation
**Current state**: Multiple shadow services for validation
**Approach**: 
- Keep dual-write mirrors for correctness (production safety net)
- Disable shadow-mode flags in all services (no longer needed)
- Archive shadow service code (keep for 1 release, then delete)

### 7.2 Monolith Table Lifecycle
**Approach**:
- Phase 1-3: Monolith tables continue being written (safety net)
- Phase 4-5: Validate zero drift for 2 weeks
- Phase 6: Stop writing from new services (monolith only), transition begins
- Phase 7: Gradual read cutover, then delete stale tables

### 7.3 Real-time Broadcast Consolidation
**Current**: realtime.ts on monolith broadcasts all events
**Approach**: 
- Each service publishes events to shared message queue (Redis Streams or Kafka)
- Single `broadcast-service` subscribes and re-emits to WebSocket clients
- Monolith's own emit becomes fire-and-forget call to broadcast-service

---

## Implementation Priorities by Business Impact

### Tier 1: Must Do First (Blocking Others)
1. Upload & Resume Service (5 services depend on file handling)
2. Real-time Notifications (every service with user interactions)
3. Complete Identity & Auth (everything depends on auth)

### Tier 2: Do Next (High Value)
4. Candidate Decisions & Applications (candidate-facing revenue)
5. Recruiter Match Discovery (recruiter-facing revenue)
6. Notifications Integration (user experience critical)

### Tier 3: Medium Term (Operational)
7. Company & Admin Operations (internal ops)
8. Analytics & Reporting (business intelligence)
9. Skills Management (data quality)

### Tier 4: Later (Lower Urgency)
10. ML & Training (optimization, not blocking)
11. Chat & Support (nice-to-have)

---

## Production Readiness Checklist (Each Phase)

For each extracted service, before cutover:

- [ ] **Database**: Migration tested, rollback script verified
- [ ] **Dual-write**: Hooks in place, fire-and-forget pattern, no user-facing failures
- [ ] **Backfill**: One-time script populates existing data
- [ ] **Validation**: Drift detection script runs hourly, zero drift for 48h
- [ ] **Cutover flag**: Environment variable gates new path, default=false (monolith)
- [ ] **Monitoring**: 
  - Latency histogram (upstream calls + DB queries)
  - Error rate by endpoint
  - Queue depths (if async)
  - Cache hit rates
- [ ] **Logging**: Structured logs with request-id, service name, operation
- [ ] **Testing**:
  - Unit tests for ported logic
  - Contract tests for cross-service APIs
  - A/B parity test (both old & new path, deep-equal response)
  - Full path integration test (nginx → gateway → service → DB)
  - Load test (1000 req/s, tail latencies)
- [ ] **Rollback drill**: Flip cutover flag, verify fallback works
- [ ] **Documentation**: 
  - Architecture diagram (service & DB)
  - Troubleshooting guide
  - On-call runbook

---

## Recommended Execution Path

### Week 1-2: Upload & Resume + Notifications Wiring
- New `upload-service` (file storage + extraction)
- Move WebSocket logic to `notifications-service` (pub/sub backend)
- Dual-write hooks in all services that emit notifications

### Week 3-4: Candidate Decisions & Applications Cutover
- Finish Item 4 (candidate-analytics) with dual-write
- Candidate Decisions flow entirely to matching-decision-service
- Applications state fully in candidate-service

### Week 5-6: Recruiter Match Discovery
- New endpoints in recruiting-service
- Fan-out to matching-scoring-service (existing)
- Materialized recruiter recommendations view (CQRS, like Item 5)

### Week 7-8: Chat Integration & Skills
- Move chat routes to chat-service
- Complete matching-reasoning-service (skills/reasoning data)
- Deprecate monolith skill intelligence routes

### Week 9-10: ML & Analytics
- Analytics-service completes materialized views
- Matching-evaluation-service owns model training orchestration

### Week 11-12: Auth Completion & Cleanup
- All auth → identity-service only
- Archive shadow services
- Final validation: zero drift across all tables

---

## Risk Mitigation

1. **Database Failures**: Every phase keeps monolith tables writable as fallback
2. **Service Failures**: Upstream proxy in api-gateway, fire-and-forget mirrors
3. **Data Corruption**: Validation scripts run continuously, dual-write guards
4. **Deployment Velocity**: Feature flags gate each cutover independently
5. **Team Capacity**: Phases can run in parallel after Phase 1 completes

---

## Success Criteria

- [ ] 100% of routes extracted to microservices
- [ ] Zero hard dependencies on monolith tables (all mirrored)
- [ ] Monolith is read-only reference backup
- [ ] All services deploy independently
- [ ] Cutover flags allow instant rollback for any service
- [ ] Zero incidents attributed to migration
- [ ] All validation scripts show 100% parity

---

## Estimated Total Effort
- **Duration**: 12-16 weeks (3-4 months)
- **Team**: 3-4 senior engineers + 1 DevOps
- **Cost**: ~$150K-200K in engineering time
- **Benefit**: Full microservices independence, 10x faster deployments, infinite horizontal scale

---

Which phase should we start with? Recommended: **Phase 1 (Upload & Notifications)** for immediate unblocking.
