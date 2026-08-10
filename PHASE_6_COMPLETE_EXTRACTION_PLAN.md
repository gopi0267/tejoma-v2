# Phase 6-9: Complete Microservices Migration Roadmap

**Duration**: Oct 2026 - June 2027 (9 months)
**Goal**: Extract 100% of functionality from monolith to microservices
**Target**: Full microservices architecture (Level 5)

---

## Executive Summary

Phase 4-5 extracted 5 read-only endpoints (30% progress). Phase 6-9 will extract the remaining 70% of the monolith:
- Phase 6 (Oct-Dec): Extract 30+ remaining read endpoints
- Phase 7 (Jan-Mar): Extract write operations + business logic
- Phase 8 (Apr-May): Implement event-driven architecture
- Phase 9 (June): Decommission monolith

**Effort**: 1700+ engineering hours
**Team**: 2-4 engineers continuously
**Cost**: $300-500k (engineering salaries)
**Risk**: Medium (proven pattern from Phase 4)

---

## Phase 6: Read Endpoint Extraction (Oct-Dec 2026)

### Goal
Extract 30+ remaining read endpoints from monolith to microservices using same strangler-fig pattern as Phase 4.

### Endpoints to Extract (Priority Order)

**Tier 1: High Priority** (used frequently, extracted first)

1. **GET /api/jobs/:id** (job detail)
   - Service: job-service
   - Dependencies: candidate-core-service (pool), matching-scoring-service (ranking)
   - Data: jobs table + local enrichment
   - Estimated effort: 8 hours
   - Status: Design phase

2. **GET /api/candidates/:id** (candidate profile)
   - Service: candidate-service
   - Dependencies: candidate-core-service (details), identity-service (recruiter info)
   - Data: candidates table + profile details
   - Estimated effort: 8 hours

3. **GET /api/candidates/:id/resume** (resume fetch)
   - Service: resume-service
   - Dependencies: resume-service (owns resumes)
   - Data: resumes table
   - Estimated effort: 4 hours

4. **GET /api/candidates/:id/profile** (profile details)
   - Service: candidate-service
   - Dependencies: candidate-core-service (local)
   - Data: candidate_profiles table
   - Estimated effort: 6 hours

5. **GET /api/candidate-search** (full-text search)
   - Service: candidate-service
   - Dependencies: matching-scoring-service (ranking)
   - Data: All candidates, fuzzy match
   - Estimated effort: 16 hours (complex SQL join)

6. **GET /api/recruiter-matches** (recruiter's matched candidates)
   - Service: matching-decision-service
   - Dependencies: None (owns swipes)
   - Data: swipes + recruiter_review_view
   - Estimated effort: 6 hours

7. **GET /api/candidate-decisions** (decision history)
   - Service: matching-decision-service
   - Dependencies: None (owns swipes)
   - Data: candidate_decisions (mirrored in Phase 4)
   - Estimated effort: 4 hours

8. **GET /api/candidate-applications** (application status)
   - Service: candidate-service
   - Dependencies: candidate-core-service (candidate details)
   - Data: candidate_application_status (mirrored in Phase 4)
   - Estimated effort: 6 hours

**Tier 2: Medium Priority** (specialized, extracted next)

9. **GET /api/skill-intelligence/:skillId** (skill demand, trends)
   - Service: matching-skill-discovery-service (currently shadow)
   - Dependencies: jobs table (required_skills)
   - Data: Aggregate skill usage across jobs
   - Estimated effort: 12 hours

10. **GET /api/role-intelligence/:roleId** (role trends, salary)
    - Service: role-intelligence-service (currently shadow)
    - Dependencies: jobs table (titles, locations)
    - Data: Aggregate role data
    - Estimated effort: 12 hours

11. **GET /api/career-intelligence/:candidateId** (career path)
    - Service: career-intelligence-service (currently shadow)
    - Dependencies: candidates table (experience)
    - Data: Position history, seniority inference
    - Estimated effort: 12 hours

12. **GET /api/proficiency-analytics** (proficiency trends)
    - Service: analytics-service (currently shadow)
    - Dependencies: candidate_decisions (proficiency scores)
    - Data: Aggregate proficiency by skill
    - Estimated effort: 10 hours

**Tier 3: Lower Priority** (rarely used, extracted last)

13. **GET /api/chat/:threadId** (chat thread)
    - Service: chat-service (currently shadow)
    - Dependencies: None (owns chats)
    - Data: chats table
    - Estimated effort: 6 hours

14. **GET /api/analytics/dashboard** (analytics overview)
    - Service: analytics-service (currently shadow)
    - Dependencies: All services (aggregation)
    - Data: Aggregate metrics
    - Estimated effort: 16 hours (complex aggregation)

15. **GET /api/ml/model-metrics** (ML model performance)
    - Service: matching-evaluation-service (currently shadow)
    - Dependencies: None (owns metrics)
    - Data: model_metrics table
    - Estimated effort: 8 hours

... (15+ more endpoints, similar effort)

### Phase 6 Implementation Strategy

**Sprint Structure** (3-week sprints, Oct-Dec):

**Sprint 6.1 (Oct 1-21)**: Jobs & Candidates Tier 1
- Extract: GET /api/jobs/:id, GET /api/candidates/:id, GET /api/candidates/:id/resume
- Effort: 20 hours/person
- Team: 2 engineers
- Outcome: 3 endpoints production-ready

**Sprint 6.2 (Oct 22-Nov 11)**: Profiles & Search Tier 1
- Extract: GET /api/candidates/:id/profile, GET /api/candidate-search
- Effort: 22 hours/person
- Team: 2 engineers
- Outcome: 2 endpoints (search is complex)

**Sprint 6.3 (Nov 12-Dec 1)**: Matching & Decisions Tier 1
- Extract: GET /api/recruiter-matches, GET /api/candidate-decisions, GET /api/candidate-applications
- Effort: 16 hours/person
- Team: 2 engineers
- Outcome: 3 endpoints

**Sprint 6.4 (Dec 2-22)**: Intelligence & Analytics Tier 2
- Extract: Skill, Role, Career intelligence + Proficiency analytics
- Effort: 46 hours/person
- Team: 2 engineers
- Outcome: 4 endpoints (some shadow→production)

**Cumulative Progress**:
- Total endpoints extracted: 30+ (from 5)
- Feature-flagged: All 30+ (safe to toggle)
- Production-ready: By Dec 31, 2026

### Phase 6 Rollout Strategy (Parallel with Phase 5)

**Same 3-stage approach as Phase 4**:
1. Canary (10% traffic): 2 weeks per endpoint group
2. Beta (50% traffic): 2 weeks per endpoint group
3. GA (100% traffic): 5 days per endpoint group

**Timeline**:
- Phase 5 rollout: Sept 15-30 (Phase 4 endpoints)
- Phase 6a rollout: Oct 15-31 (first batch of Phase 6)
- Phase 6b rollout: Nov 15-30 (second batch)
- Phase 6c rollout: Dec 15-31 (third batch)

**Parallel execution**: Implement Phase 6 while rolling out Phase 5

---

## Phase 7: Write Operations & Business Logic (Jan-Mar 2027)

### Goal
Migrate all POST/PUT/DELETE operations and business logic from monolith to services.

### Operations to Extract

**Priority 1: Swipe Operations** (highest risk, highest impact)

1. **POST /api/swipes** (new swipe decision)
   - Current: Monolith writes + validates + triggers matching
   - Target: matching-decision-service (owns swipes)
   - Business logic: 
     - Validate candidate-job pair exists
     - Compute match score
     - Trigger notifications
     - Record decision in dual-write
   - Effort: 40 hours
   - Risk: High (core business logic)

2. **PATCH /api/recruiter-review/:id/:id/decision** (change decision)
   - Current: Monolith updates swipe + triggers cascading changes
   - Target: matching-decision-service
   - Business logic: Cascade to candidate_decisions, trigger events
   - Effort: 24 hours

3. **POST /api/recruiter-review/:id/:id/notes** (recruiter note)
   - Current: Monolith writes to recruiter_notes
   - Target: matching-decision-service
   - Business logic: Validate, timestamp, trigger search index update
   - Effort: 12 hours

**Priority 2: Candidate Operations**

4. **POST /api/candidates** (new candidate)
   - Current: Monolith validates + creates
   - Target: candidate-core-service (owns candidates)
   - Business logic: Profile validation, email verification, skill parsing
   - Effort: 32 hours

5. **PUT /api/candidates/:id** (update candidate)
   - Current: Monolith updates + triggers mirroring
   - Target: candidate-core-service
   - Business logic: Skill inference, proficiency update, trigger analytics
   - Effort: 28 hours

6. **POST /api/candidates/:id/profile** (update profile)
   - Current: Monolith updates candidate_profiles
   - Target: candidate-service
   - Business logic: Skill extraction, validation
   - Effort: 20 hours

**Priority 3: Job Operations**

7. **POST /api/jobs** (new job)
   - Current: Monolith validates + creates
   - Target: job-service (owns jobs)
   - Business logic: JD parsing, skill extraction, requirement validation
   - Effort: 32 hours

8. **PUT /api/jobs/:id** (update job)
   - Current: Monolith updates + triggers reranking
   - Target: job-service
   - Business logic: Re-index candidates, trigger matching
   - Effort: 24 hours

9. **DELETE /api/jobs/:id** (archive job)
   - Current: Monolith soft-delete + cleanup
   - Target: job-service
   - Business logic: Cascade to related data
   - Effort: 12 hours

**Business Logic Extraction** (Core algorithms)

10. **Matching Algorithm** (score computation)
    - Current: In monolith src/matching/*.ts (pure functions)
    - Target: matching-scoring-service (port existing code)
    - Logic: All pure (no side effects) → safe to move
    - Effort: 48 hours (testing + verification)

11. **Skill Proficiency** (skill-job matching)
    - Current: In monolith (pure function)
    - Target: matching-skill-discovery-service
    - Logic: Pure computation → safe to move
    - Effort: 24 hours

12. **Career Intelligence** (seniority, progression)
    - Current: In monolith (pure function)
    - Target: career-intelligence-service
    - Logic: Pure computation → safe to move
    - Effort: 20 hours

13. **Role Intelligence** (role analysis)
    - Current: In monolith (pure function)
    - Target: role-intelligence-service
    - Logic: Pure computation → safe to move
    - Effort: 20 hours

### Phase 7 Implementation Strategy

**Sprint 7.1 (Jan 1-21)**: Swipe Operations + Logic
- Migrate: POST /swipes, PATCH /decision, POST /notes
- Extract: Matching algorithm (core logic)
- Effort: 76 hours/person
- Team: 2 engineers
- Risk: High (critical path)
- Mitigation: Comprehensive testing, A/B parity validation

**Sprint 7.2 (Feb 1-21)**: Candidate Operations
- Migrate: POST/PUT /candidates, POST /candidates/:id/profile
- Extract: Skill proficiency logic
- Effort: 80 hours/person
- Team: 2 engineers

**Sprint 7.3 (Mar 1-21)**: Job Operations
- Migrate: POST/PUT/DELETE /jobs
- Extract: Career + Role intelligence
- Effort: 68 hours/person
- Team: 2-3 engineers

**Cumulative Progress**:
- Write operations migrated: 100% (all POST/PUT/DELETE)
- Business logic extracted: 100% (all algorithms)
- Monolith functions: 0% (all moved to services)

### Phase 7 Key Challenges

**Challenge 1: Transactions & Consistency**
- Problem: Monolith uses transactions, services will use eventual consistency
- Solution: Implement saga pattern for multi-step operations
- Example:
  ```
  POST /swipes:
    1. matching-decision writes swipe
    2. Emits "swipe.created" event
    3. candidate-core subscribes, updates stats
    4. job-service subscribes, updates counts
    5. If step 3 fails, compensate (delete swipe)
  ```
- Effort: 40 hours (testing compensations)

**Challenge 2: Validation & Business Rules**
- Problem: Monolith enforces rules (validate candidate-job pair exists, etc.)
- Solution: Replicate business rules in each service, use event validation
- Effort: 60 hours (rule migration + testing)

**Challenge 3: Cascading Updates**
- Problem: One write triggers multiple updates (e.g., swipe → recruiter_notes → analytics)
- Solution: Event-driven (event subscribers handle cascades)
- Effort: 40 hours (event definitions + handlers)

---

## Phase 8: Event-Driven Architecture (Apr-May 2027)

### Goal
Implement event bus and service mesh to enable true async communication and operational maturity.

### Changes Required

**1. Event Bus Implementation** (Kafka or RabbitMQ)

```
Before (Phase 7 - RPC):
  matching-decision-service → POST /api/swipes → writes to DB
  No other service knows about it

After (Phase 8 - Event-driven):
  matching-decision-service → writes to DB → emits "swipes.created"
  candidate-service subscribes → updates candidate stats
  job-service subscribes → updates job stats
  analytics-service subscribes → updates aggregates
  notifications-service subscribes → sends notifications
```

**Events to Define** (20+ business events):
- `candidate.created`, `candidate.updated`, `candidate.deleted`
- `job.created`, `job.updated`, `job.deleted`
- `swipe.created`, `swipe.changed`
- `recruiter_note.created`, `recruiter_note.updated`
- `decision.made`, `decision.changed`
- `match.found`, `application.progressed`
- ... (10+ more)

**Effort**: 60 hours
- Event schema definition (5h)
- Kafka/RabbitMQ setup (10h)
- Publisher implementation (20h)
- Subscriber implementation (25h)

**2. Service Mesh** (Istio or Linkerd)

**Before (Phase 7)**:
- Direct RPC calls: service A → service B
- Basic health checks
- Manual retry logic

**After (Phase 8)**:
- Istio/Linkerd handles: routing, retries, circuit breakers, timeouts
- Distributed tracing: Jaeger shows full request path
- Traffic splitting: Canary deployments easier
- Observability: Metrics from mesh level

**Effort**: 40 hours
- Mesh setup (10h)
- Service integration (15h)
- Tracing setup (10h)
- Monitoring (5h)

**3. Service Discovery** (Kubernetes native)

**Before (Phase 7)**:
- Hardcoded URLs: `http://job-service:4018`
- Manual DNS management

**After (Phase 8)**:
- K8s DNS: service names resolve automatically
- Load balancing: K8s distributes traffic
- Failover: automatic pod restart

**Effort**: 15 hours (mostly K8s configuration)

**4. Distributed Tracing** (Jaeger)

**Before (Phase 7)**:
- Logs only (grep logs across 5 services)
- No request flow visibility

**After (Phase 8)**:
- Trace shows: request → job-service → candidate-core-service → database
- Latency breakdown per service
- Error tracing (which service failed?)

**Effort**: 20 hours (instrumentation + dashboard)

### Phase 8 Implementation

**Sprint 8.1 (Apr 1-21)**: Event Bus
- Kafka setup (production cluster)
- Event schema definition
- Publisher implementation in all services
- Effort: 60 hours/person
- Team: 2 engineers

**Sprint 8.2 (May 1-21)**: Service Mesh + Tracing
- Istio/Linkerd deployment
- Service integration
- Jaeger tracing setup
- Performance monitoring
- Effort: 75 hours/person
- Team: 2 engineers

**Cumulative Progress**:
- Event bus operational: 100%
- Service mesh operational: 100%
- Distributed tracing: 100%
- Async communication: 100%

---

## Phase 9: Monolith Decommissioning (June 2027)

### Goal
Remove monolith from production, finalize full microservices architecture.

### Pre-Decommission Checklist

**Functionality** ✅
- [ ] All 100+ endpoints migrated to services
- [ ] All write operations in services
- [ ] All business logic in services
- [ ] All data in service databases (migrated from monolith)

**Operations** ✅
- [ ] Monitoring dashboards for all services
- [ ] Alerting configured (PagerDuty)
- [ ] Runbooks for common failures
- [ ] On-call rotation established
- [ ] Incident response tested

**Data** ✅
- [ ] No drift between monolith and services (validation scripts)
- [ ] All historical data migrated to cold storage
- [ ] Backup strategy verified
- [ ] Disaster recovery tested

**Testing** ✅
- [ ] Load testing at production levels (10k req/s)
- [ ] Chaos engineering (kill services, verify recovery)
- [ ] Full integration tests (all services together)
- [ ] Parity tests complete

### Decommissioning Steps

**Step 1: Archive Monolith Code** (1 day)
```bash
# Keep read-only archive for reference
git tag v1.0-monolith-archived
# Move to archive branch (not main)
git branch archive/monolith-main monolith-main
```

**Step 2: Turn Off Monolith Services** (1 day)
```
1. Stop accepting requests (put in maintenance mode)
2. Redirect traffic to api-gateway
3. Monitor error rate (should be 0)
4. Wait 24 hours (ensure all caches expired)
```

**Step 3: Migrate Historical Data** (2-3 days)
- Export old audit logs to cold storage (S3)
- Archive old backups (not needed, services own data)
- Delete sensitive data per compliance

**Step 4: Cleanup Infrastructure** (1 day)
- Decommission monolith servers
- Remove from monitoring dashboards
- Update documentation
- Update runbooks (remove monolith references)

**Step 5: Final Validation** (1 day)
- Verify all services healthy
- Run full integration test suite
- Confirm no monolith dependencies
- Declare full microservices ✅

**Total effort**: 20 hours (mostly cleanup)

---

## Overall Timeline & Milestones

```
┌─────────────────────────────────────────────────────────────┐
│ Aug 2026: Phase 4 Complete                                 │
│ ✅ 5 read endpoints extracted (30%)                        │
│ ✅ Feature flags, dual-writes, validation scripts          │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Sept 2026: Phase 5 Testing & Rollout                       │
│ ✅ A/B parity tests                                        │
│ ✅ Canary (10%) → Beta (50%) → GA (100%)                   │
│ ✅ Phase 4 endpoints in production                         │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Oct-Dec 2026: Phase 6 Read Extraction                      │
│ ✅ 30+ more read endpoints (60% total)                     │
│ ✅ Skill, Role, Career intelligence (shadow→production)    │
│ ✅ Parallel rollout with Phase 5                           │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Jan-Mar 2027: Phase 7 Write & Logic Extraction             │
│ ✅ All POST/PUT/DELETE operations (90% total)              │
│ ✅ All business logic ported (algorithms, validation)      │
│ ✅ Monolith now read-only (archive only)                   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Apr-May 2027: Phase 8 Event-Driven Architecture            │
│ ✅ Kafka/RabbitMQ event bus                                │
│ ✅ Istio/Linkerd service mesh                              │
│ ✅ Distributed tracing (Jaeger)                            │
│ ✅ Service discovery (K8s native)                          │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ June 2027: Phase 9 Monolith Decommissioning                │
│ ✅ Archive monolith code                                   │
│ ✅ Migrate historical data to cold storage                 │
│ ✅ Decommission infrastructure                             │
│ ✅ FULL MICROSERVICES ACHIEVED! 🎉                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Resource Planning

### Team Composition

**Core Team** (4 engineers, continuous through June 2027):
- Platform Lead (1) - Architecture, planning, oversight
- Senior Backend Engineer (1) - Complex migrations, event bus
- Backend Engineer (1) - Read extraction, business logic
- Infrastructure Engineer (1) - Kubernetes, service mesh, monitoring

**Surge Capacity**:
- Q1 2027 (Phase 7): Add 2 more engineers (write operations)
- Q2 2027 (Phase 8-9): Add 1 infrastructure engineer (mesh + decommission)

### Budget Estimate

| Phase | Duration | Team | Cost |
|-------|----------|------|------|
| 5 | 1 month | 2 | $40k |
| 6 | 3 months | 2-3 | $100k |
| 7 | 3 months | 3-4 | $140k |
| 8 | 2 months | 2-3 | $70k |
| 9 | 1 month | 2 | $20k |
| **Total** | **10 months** | **2-4 avg** | **$370k** |

---

## Risk Management

### Phase 6 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Complex read queries fail to port | Medium | Medium | Comprehensive testing, A/B parity |
| Performance degrades on complex queries | Medium | High | Caching layer, query optimization |
| Data consistency issues | Low | High | Validation scripts, monitoring |

### Phase 7 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Write operations lose transactions | High | Critical | Saga pattern, comprehensive testing |
| Business logic migration errors | Medium | Critical | Pure function isolation, parity tests |
| Cascading failures (events propagate errors) | Medium | High | Circuit breakers, event validation |

### Phase 8 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Event bus becomes bottleneck | Low | Medium | Kafka partitioning, scaling |
| Service mesh adds latency | Medium | Medium | Mesh tuning, performance testing |
| Distributed tracing overhead | Low | Low | Sampling, batching |

### Phase 9 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Monolith still needed for edge cases | Low | Critical | Comprehensive testing before cutoff |
| Data loss during migration | Very Low | Critical | Backup + validation before delete |
| Services unstable after monolith removed | Low | Critical | Extensive staging validation |

---

## Success Criteria

### Phase 6 (Read Extraction)
- [ ] 30+ endpoints extracted and working
- [ ] Zero parity violations (A/B tests pass 100%)
- [ ] Performance acceptable (P99 latency < 200ms)
- [ ] Zero data drift (validation scripts pass)

### Phase 7 (Write & Logic)
- [ ] All write operations working in services
- [ ] All business logic ported correctly
- [ ] Transactions working (saga pattern validated)
- [ ] Zero business logic regressions (same results as monolith)

### Phase 8 (Event-Driven)
- [ ] Event bus operational (all events flowing)
- [ ] Service mesh in production (traffic controlled)
- [ ] Distributed tracing working (full request visibility)
- [ ] Performance improved (lower latency, better scaling)

### Phase 9 (Decommissioning)
- [ ] Monolith successfully archived
- [ ] All data migrated to services
- [ ] Zero dependency on monolith
- [ ] Full microservices in production ✅

---

## Documentation Updates

**Create these documents**:
- [ ] `PHASE_6_ENDPOINT_EXTRACTION_GUIDE.md` - How to extract each endpoint type
- [ ] `PHASE_7_BUSINESS_LOGIC_MIGRATION.md` - How to port algorithms
- [ ] `PHASE_8_EVENT_DRIVEN_GUIDE.md` - Event definitions, subscribers
- [ ] `MICROSERVICES_FINAL_RUNBOOK.md` - Operations guide for full MS

**Update existing**:
- [ ] PHASE_5_RUNBOOK.md - Extend to Phase 6+ rollout procedures
- [ ] docker-compose.yml - Add event bus (Kafka), service mesh config
- [ ] helm/ charts - Add service mesh, event bus deployments

---

## Conclusion

Phase 6-9 will complete the microservices migration, transforming Tejoma from a hybrid architecture to a true, event-driven, scalable microservices platform.

**Timeline**: 10 months (Sept 2026 - June 2027)
**Effort**: 1700+ hours (~$370k in salaries)
**Result**: Full microservices (Level 5 architecture)

**Next Step**: Execute Phase 5, then plan Phase 6 in detail

---

**Owner**: Platform Engineering
**Status**: Ready for execution (after Phase 5 complete)
**Last Updated**: Aug 6, 2026
