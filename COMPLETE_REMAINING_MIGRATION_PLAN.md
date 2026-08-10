# Complete Remaining Monolith-to-Microservices Migration Plan

**Date**: 2026-08-07  
**Scope**: ALL remaining monolith components → microservices  
**Timeline**: 12-16 weeks (3-4 months)  
**Overall Completion**: 100% migration to microservices  

---

## CURRENT STATUS (as of 2026-08-07)

### Already Completed ✅
- **Phase 1 Reads**: 5/15 endpoints (33%)
- **Phase 2 Writes**: 25+/30+ endpoints (95%)
- **Production Ready**: Canary deployment documented

### Remaining Work 📋
- **Phase 1 Reads**: 10 endpoints (analytics, ML, recruiter-review)
- **Phase 2 Writes**: 5 endpoints (chat persistence, uploads refinements)
- **Phase 3**: Event-driven architecture, service mesh, decommission monolith

---

## PHASE 1 REMAINING: READ OPERATIONS (10 endpoints)

### Block 1A: Analytics Endpoints (4 endpoints, 20 hours)

#### 1. GET /api/analytics/dashboard (Recruiter Dashboard)
**Service**: analytics-service  
**Current**: Proxies to monolith  
**Requirement**: Orchestrate data from 5+ services

**Implementation**:
```
1. Create internal endpoints in each service:
   - job-service: GET /internal/jobs/stats (count, active, avg_salary)
   - candidate-core-service: GET /internal/candidates/stats (count, skills_distribution)
   - matching-decision-service: GET /internal/swipes/stats (total, acceptance_rate, avg_score)
   - recruiting-service: GET /internal/recruiter/stats (notifications_pending, matches_pending)
   - candidate-service: GET /internal/profiles/stats (profiles_complete, open_to_work_count)

2. Create service clients in analytics-service:
   - jobServiceClient.getStats()
   - candidateCoreServiceClient.getStats()
   - matchingDecisionServiceClient.getStats()
   - candidateServiceClient.getStats()
   - recruitingServiceClient.getStats()

3. Implement aggregation handler:
   - Fetch all stats in parallel (5s timeout each)
   - Aggregate into dashboard response
   - Add trend calculation
   - Add date-based filtering

4. Add feature flag: ANALYTICS_DASHBOARD_CUTOVER_ENABLED

5. Dual-write: Keep monolith as fallback

Effort: 20 hours
Complexity: MEDIUM (multiple service calls)
Risk: LOW (read-only)
```

#### 2. GET /api/ml/config (Model Configuration)
**Service**: matching-scoring-service  
**Current**: Proxies to monolith  
**Requirement**: Read local model state

**Implementation**:
```
1. Create local state management:
   - Store in matching_model_config table
   - Fields: active_model_type, is_retraining, last_training_timestamp

2. Implement handler:
   - Query local table
   - Return JSON with current config

3. Add feature flag: ML_CONFIG_CUTOVER_ENABLED

Effort: 5 hours
Complexity: LOW (pure local)
Risk: LOW
```

#### 3. GET /api/ml/model/status (Model Status)
**Service**: matching-scoring-service  
**Current**: Proxies to monolith  
**Requirement**: Return training status

**Implementation**:
```
1. Create training_status table in matching-scoring-service
   - Fields: status (idle/training), progress, started_at, eta, error_message

2. Implement handler:
   - Query local table
   - Return status JSON

3. Add feature flag: ML_STATUS_CUTOVER_ENABLED

Effort: 5 hours
Complexity: LOW
Risk: LOW
```

#### 4. GET /api/ml/model/versions (Model Versions)
**Service**: matching-scoring-service  
**Current**: Proxies to monolith  
**Requirement**: List all trained model versions

**Implementation**:
```
1. Create model_versions table
   - Fields: version_id, model_type, accuracy, f1_score, trained_at, deployed_at, is_current

2. Implement handler:
   - Query all versions ordered by trained_at DESC
   - Return list with current version highlighted

3. Add feature flag: ML_VERSIONS_CUTOVER_ENABLED

Effort: 5 hours
Complexity: LOW
Risk: LOW
```

### Block 1B: Recruiter Review Detail (2 endpoints, 15 hours)

#### 5. GET /api/recruiter-review/:candidateId/:jobId (Decision Detail)
**Service**: matching-decision-service  
**Current**: Proxies to monolith  
**Requirement**: Return swipe + notes + score breakdown

**Implementation**:
```
1. Create GET /internal/swipes/:id endpoint in matching-decision-service
   - Query swipes table
   - Join with recruiter_notes (last 10)
   - Include match_score breakdown
   - Include decision history (all decisions for this pair)

2. Implement service handler:
   - Fetch swipe record locally
   - Fetch all notes for this swipe
   - Compute decision timeline
   - Return full detail object

3. Add feature flag: RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED

Effort: 10 hours
Complexity: MEDIUM (multi-table join)
Risk: LOW (read-only)
```

### Block 1C: Recruiter Review List (2 endpoints, 25 hours)

#### 6. GET /api/recruiter-review (List with pagination/filtering)
**Service**: matching-decision-service  
**Current**: Complex 5-table join (hard to extract)  
**Requirement**: Full CQRS materialized view

**Implementation** (CRITICAL - Most Complex):
```
1. Create recruiter_review_view table (CQRS materialized view):
   Columns:
   - id (unique per candidate-job pair)
   - candidate_id, job_id, company_id
   - candidate_name, candidate_email, candidate_phone
   - candidate_skills, candidate_years_exp, candidate_company, candidate_location
   - job_title, job_location, job_required_skills
   - recruiter_id, recruiter_name
   - swipe_id, action (0/0.5/1), match_score
   - latest_note_text, latest_note_at
   - decision_date, created_at, updated_at

2. Create indexes:
   - (company_id, created_at DESC) - for list queries
   - (company_id, recruiter_id, created_at DESC) - for recruiter filter
   - (company_id, job_id, created_at DESC) - for job filter
   - (company_id, action, created_at DESC) - for decision filter
   - GIN index on candidate_skills for search

3. Hook into write paths (keep monolith writing to swipes):
   - POST /swipes → call db.upsertRecruiterReviewViewRow (already partially done)
   - PATCH /decision → call db.updateRecruiterReviewViewDecision
   - POST /notes → call db.updateRecruiterReviewViewNote

4. Hook into other services (new outbound calls):
   - candidate-core-service POST → POST /internal/recruiter-review-view/refresh-candidate
   - candidate-service PUT → POST /internal/recruiter-review-view/refresh-profile
   - job-service PUT → POST /internal/recruiter-review-view/refresh-job
   - identity-service PUT (recruiter name) → POST /internal/recruiter-review-view/refresh-recruiter

5. Create view endpoints in matching-decision-service:
   - GET /api/recruiter-review?company_id=&job_id=&recruiter_id=&action=&search=&page=&limit=
   - Query view table with all filters
   - Support full-text search on candidate_skills, name, email
   - Return paginated results with total count

6. Add feature flag: RECRUITER_REVIEW_LIST_CUTOVER_ENABLED

Effort: 25 hours
Complexity: HIGH (distributed write coordination)
Risk: MEDIUM (CQRS coordination across services)
Mitigation: Keep monolith as source-of-truth, dual-write to view, validate weekly
```

### Block 1D: Skill/Role/Career Intelligence (2 endpoints, TBD)

#### 7-8. Skill/Role/Career Intelligence Endpoints
**Status**: NOT IN MONOLITH (new features)  
**Decision**: Build directly in specialized services (skip extraction)

**Build in specialized services**:
- skill-intelligence-service: GET /api/skill-intelligence/demand, /supply, /trends
- role-intelligence-service: GET /api/role-intelligence/market, /progression
- career-intelligence-service: GET /api/career-intelligence/paths, /transitions

**Effort**: 30-40 hours (full development)  
**Risk**: LOW (new features, no migration needed)  
**Recommendation**: Build post-Phase 2 in parallel

---

## PHASE 2 REMAINING: WRITE OPERATIONS (5 endpoints)

### Block 2A: Chat Persistence (3 endpoints, 20 hours)

#### 1. POST /api/chat/:threadId/messages (Send Message)
**Service**: chat-service  
**Current**: Stateless (no persistence)  
**Requirement**: Store chat messages in DB

**Implementation**:
```
1. Create tables in chat-service:
   - chat_threads (id, company_id, recruiter_id, candidate_id, title, created_at, updated_at)
   - chat_messages (id, thread_id, role, content, embedding, created_at)

2. Create migrations:
   - 001_create_chat_tables.up.sql
   - Index on (thread_id, created_at)
   - Index on (recruiter_id, created_at)

3. Implement handlers:
   - POST /api/chat/:threadId/messages
     - Fetch thread (verify access)
     - Store message in DB
     - Generate embedding
     - Update thread's updated_at
     - Return message with ID

4. Implement dual-write to monolith:
   - After local store succeeds, call monolithClient.createChatMessage
   - Fire-and-forget, never block

5. Add feature flag: CHAT_MESSAGE_PERSISTENCE_ENABLED

Effort: 20 hours
Complexity: MEDIUM (new persistence layer)
Risk: LOW (new feature, no migration from monolith)
```

#### 2. PUT /api/chat/:threadId/messages/:msgId (Edit Message)
**Service**: chat-service  
**Implementation**:
```
1. Update chat_messages table
2. Store edit history (version control)
3. Dual-write to monolith
4. Add feature flag: CHAT_MESSAGE_EDIT_ENABLED

Effort: 8 hours
```

#### 3. DELETE /api/chat/:threadId/messages/:msgId (Delete Message)
**Service**: chat-service  
**Implementation**:
```
1. Soft delete (set deleted_at)
2. Remove from RAG index
3. Dual-write to monolith
4. Add feature flag: CHAT_MESSAGE_DELETE_ENABLED

Effort: 5 hours
```

### Block 2B: Upload Refinements (2 endpoints, 15 hours)

#### 4. POST /api/upload/:id/chunk (Chunked Upload)
**Service**: upload-service  
**Current**: Partially implemented  
**Requirement**: Multi-part upload support

**Implementation**:
```
1. Create upload_chunks table
   - Fields: upload_id, chunk_number, chunk_data, upload_checksum

2. Create endpoints:
   - POST /api/upload/:id/chunk (store chunk)
   - POST /api/upload/:id/finalize (assemble chunks)

3. Implement validation:
   - Checksum verification per chunk
   - Total size validation
   - Sequential chunk assembly

Effort: 15 hours
```

#### 5. DELETE /api/upload/:id (Delete Upload)
**Service**: upload-service  
**Implementation**:
```
1. Soft delete upload record
2. Mark chunks for cleanup
3. Remove from storage (S3)
4. Update monolith via dual-write

Effort: 5 hours
```

---

## PHASE 3: EVENT-DRIVEN ARCHITECTURE (60-80 hours)

### Block 3A: Event Bus Setup (20 hours)

#### 1. Kafka/RabbitMQ Infrastructure
**Decision**: Use Kafka for event streaming (better for this scale)

**Setup**:
```
1. Deploy Kafka cluster:
   - 3 broker nodes (production HA)
   - 3 ZooKeeper nodes
   - Kafka Connect for integrations

2. Create topics (one per domain):
   - candidates.events (candidate CRUD + profile changes)
   - jobs.events (job CRUD + status changes)
   - swipes.events (swipe recorded + decision changed)
   - matches.events (mutual match formed)
   - recruiter-review.events (notes added, decision changed)
   - chat.events (message sent, thread created)
   - notifications.events (notification created, read)

3. Schema registry (Avro schemas):
   - Define event schemas for each topic
   - Version control schemas
   - Track breaking changes

4. Monitoring:
   - Kafka metrics (lag, throughput, broker health)
   - Consumer group monitoring
   - Dead letter queue setup

Effort: 20 hours
Complexity: HIGH
Risk: HIGH (distributed system coordination)
```

### Block 3B: Event Producers (Dual-Write → Events) (20 hours)

#### 1. Rewrite Dual-Write as Event Publishing
**Current Pattern**: Dual-write to monolith (sync)  
**New Pattern**: Publish events to Kafka (async)

**Services Publishing Events**:
```
1. candidate-core-service:
   - Events: CandidateCreated, CandidateUpdated, CandidateDeleted
   - Publish on POST, PUT, DELETE /candidates

2. job-service:
   - Events: JobCreated, JobUpdated, JobDeleted, JobStatusChanged
   - Publish on POST, PUT, DELETE /jobs

3. matching-decision-service:
   - Events: SwipeRecorded, DecisionChanged, NoteAdded, MatchFormed
   - Publish on POST, PATCH, DELETE operations

4. candidate-service:
   - Events: ProfileUpdated, SkillsUpdated, ExperienceAdded, ApplicationStatusChanged
   - Publish on PUT, POST, PATCH operations

5. chat-service:
   - Events: MessageSent, MessageDeleted, ThreadCreated
   - Publish on POST, DELETE operations

6. upload-service:
   - Events: FileUploaded, FileDeleted, ProcessingCompleted
   - Publish on POST, DELETE operations

Implementation per service:
1. Create eventPublisher.ts (Kafka client)
2. Replace monolithClient.dualWrite* calls with eventPublisher.publish*
3. Keep monolith subscription for 90-day safety window
4. Dual-write + event publish (belt-and-suspenders) for 30 days
5. Flip to events-only after validation

Effort: 20 hours
```

### Block 3C: Event Consumers (Services React to Events) (25 hours)

#### 1. Implement Event Consumers
**Goal**: Services react to events from other services

```
Services & Their Consumers:
1. matching-decision-service consumes:
   - candidates.* → refresh recruiter_review_view when candidate changes
   - jobs.* → refresh recruiter_review_view when job changes

2. recruiting-service consumes:
   - swipes.SwipeRecorded → create recruiter notification
   - recruiter-review.DecisionChanged → update notification status

3. candidate-core-service consumes:
   - Nothing initially (source of truth for candidates)

4. job-service consumes:
   - Nothing initially (source of truth for jobs)

5. chat-service consumes:
   - Nothing initially (owns chat domain)

6. analytics-service consumes:
   - ALL events → materialize dashboard views
   - swipes.*, candidates.*, jobs.* → build materialized analytics tables

Implementation per consumer:
1. Create consumer group (e.g., matching-decision-service-candidates-consumer)
2. Implement message handler
3. Idempotency key (prevent duplicate processing)
4. Error handling (retry, dead-letter queue)
5. Monitoring (lag, processing time)
6. Testing (integration tests with Kafka testcontainers)

Effort: 25 hours
```

### Block 3D: Service Mesh (Istio) (25 hours)

#### Setup Service Mesh
```
1. Install Istio control plane:
   - Ingressgateway (edge routing)
   - Istiod (config management)
   - Sidecar injection (automatic envoy injection)

2. Configure traffic policies:
   - VirtualServices (traffic routing rules)
   - DestinationRules (load balancing, connection pooling)
   - ServiceEntries (external service access)

3. Security:
   - mTLS (mutual TLS between services)
   - Authorization policies (who can call what)
   - Network policies (namespace isolation)

4. Observability:
   - Distributed tracing (Jaeger integration)
   - Metrics (Prometheus scraping)
   - Logs (structured logging)

5. Resilience:
   - Retry policies (automatic retries)
   - Circuit breakers (failfast on errors)
   - Timeouts (request-level timeouts)
   - Rate limiting (prevent cascade failures)

Effort: 25 hours
```

### Block 3E: Distributed Tracing (Jaeger) (15 hours)

#### Implement Distributed Tracing
```
1. Deploy Jaeger:
   - Collector (receives traces)
   - Query (searches traces)
   - Storage (retention)

2. Instrument services:
   - Add tracing client library (OpenTelemetry)
   - Wrap HTTP calls with trace spans
   - Track cross-service calls
   - Record error details

3. Create dashboards:
   - Service dependency graph
   - Request flow visualization
   - Latency breakdown by service
   - Error rate by service

4. Alerting:
   - Alert on slow traces (> 1s)
   - Alert on error traces
   - Alert on missing traces (infrastructure issues)

Effort: 15 hours
```

---

## MONOLITH DECOMMISSIONING (30 hours)

### Block 4A: Monolith to Read-Only (10 hours)

#### 1. Stop Writes to Monolith
```
1. Verify all write operations migrated to services
2. Check: dual-write → events transition complete
3. Disable all POST/PUT/PATCH/DELETE endpoints in monolith
4. Monolith becomes read-only cache

Effort: 10 hours
```

### Block 4B: Monolith to Backup (15 hours)

#### 1. Prepare Monolith as Warm Backup
```
1. Set up replication:
   - All service databases → replicate to monolith DB
   - Cron job to sync every 1 hour
   - Verification checks (checksum validation)

2. Disable access:
   - Firewall rules: only internal access
   - No external traffic routed

3. Decommission plans:
   - Document how to restore if needed
   - Keep for 6 months as safety net

Effort: 15 hours
```

### Block 4C: Decommission Monolith (5 hours)

#### 1. Final Decommission
```
1. Archive monolith code (git tag final-monolith)
2. Archive monolith database (snapshot, S3)
3. Stop monolith services
4. Delete monolith infrastructure
5. Clean up DNS/load balancer rules

Effort: 5 hours
```

---

## COMPREHENSIVE MIGRATION TIMELINE

### Phase 1: Production Canary Deployment (Weeks 1-4)
**Already planned**. Focus on Phase 1 read (5 done) + Phase 2 writes (25+ done).

### Phase 1B: Complete Phase 1 Remaining (Weeks 5-7, 60 hours)
- Week 5: Analytics endpoints (20 hours)
- Week 6: ML endpoints (15 hours)  
- Week 7: Recruiter review (25 hours)

### Phase 2B: Complete Phase 2 Remaining (Week 8, 40 hours)
- Week 8: Chat persistence (20 hours), Uploads (15 hours)

### Phase 3: Event-Driven Architecture (Weeks 9-13, 125 hours)
- Week 9: Kafka setup (20 hours)
- Week 10-11: Event producers (20 hours)
- Week 12-13: Event consumers (25 hours), Service mesh (25 hours), Tracing (15 hours)

### Phase 4: Monolith Decommissioning (Week 14, 30 hours)
- Week 14: Read-only (10h), Backup setup (15h), Final decommission (5h)

---

## TOTAL EFFORT & TIMELINE

### Overall Stats
| Phase | Endpoints | Effort | Weeks | Status |
|-------|-----------|--------|-------|--------|
| Phase 1A (Complete) | 5/15 | 25h | Done | ✅ |
| Phase 1B (Remaining) | 10/15 | 60h | W5-7 | 📋 |
| Phase 2A (Complete) | 25+/30+ | 150h | Done | ✅ |
| Phase 2B (Remaining) | 5/30+ | 40h | W8 | 📋 |
| Phase 3 (Events + Mesh) | N/A | 125h | W9-13 | 📋 |
| Phase 4 (Decommission) | N/A | 30h | W14 | 📋 |
| **TOTAL** | **50+/50+** | **430h** | **14 weeks** | **📋** |

### Calendar (Starting Week of Aug 7)
- **Aug 7-27**: Phase 1A + Canary rollout (already planned, 4 weeks)
- **Aug 28-Sep 17**: Phase 1B + Phase 2 production (3 weeks, 100 hours)
- **Sep 18-24**: Phase 2B (1 week, 40 hours)
- **Sep 25-Oct 22**: Phase 3 (5 weeks, 125 hours)
- **Oct 23-29**: Phase 4 (1 week, 30 hours)

**Complete Monolith-to-Microservices Migration: October 29, 2026** (14 weeks from start)

---

## IMPLEMENTATION STRATEGY

### Parallel Tracks
Run these in parallel to compress timeline:

**Track 1: Phase 1B + 2B (Weeks 5-8)**
- Implement remaining read/write operations
- Keep both tracks separate, no coordination needed

**Track 2: Phase 3 (Weeks 9-13, overlaps with above)**
- Start Kafka setup while Phase 1B/2B finishing
- Parallel: Event producers + consumers + mesh

**Track 3: Phase 4 (Week 14)**
- Decommission after Phase 3 stable

### Parallel Compression (13 weeks total)
If you run Phases 1B + 2B + 3 in true parallel:
- Phase 1B & 2B: 8 weeks (same team, different endpoints)
- Phase 3: Start week 5, run weeks 5-13 (8 weeks)
- Both done week 13
- Phase 4: week 14

**Total: 14 weeks (no compression gains, infrastructure is sequential)**

---

## RESOURCE REQUIREMENTS

### Team Composition
- **Backend Engineers**: 4-5 (implementation)
- **DevOps Engineers**: 2 (infrastructure, Kafka, Istio)
- **QA Engineers**: 2 (testing, validation)
- **Tech Lead**: 1 (architecture decisions, reviews)
- **Product**: 1 (communication, rollout strategy)

**Total: 10-11 engineers, 14 weeks**

### Infrastructure
- **Kafka Cluster**: 3 nodes (HA)
- **Istio Control Plane**: 1 cluster
- **Jaeger Backend**: Collector + storage
- **Database**: Replicate monolith schema to all services
- **Monitoring**: Prometheus + Grafana (already in place)

---

## SUCCESS CRITERIA (Per Phase)

### Phase 1B
- [ ] All 10 analytics/ML endpoints migrated
- [ ] Recruiter review list CQRS view stable
- [ ] Zero parity drift for all endpoints
- [ ] Staging + canary validation passing

### Phase 2B
- [ ] Chat persistence working
- [ ] Upload chunking working
- [ ] All 30+ write operations live
- [ ] Monolith proxy routes removed

### Phase 3
- [ ] Kafka topics created, producers publishing
- [ ] Consumers running, event handling working
- [ ] Service mesh fully operational
- [ ] Distributed tracing working
- [ ] Zero data loss during event cutover

### Phase 4
- [ ] Monolith read-only, no writes
- [ ] Replication to monolith working
- [ ] All traffic on microservices
- [ ] Monolith decommissioned

---

## ROLLBACK STRATEGY

### Per-Phase Rollback
- **Phase 1B**: Flip feature flags (instant)
- **Phase 2B**: Flip feature flags (instant)
- **Phase 3**: 
  - Revert event consumers (restart services)
  - Keep Kafka running (safety net)
  - Fall back to monolith dual-writes temporarily
  - Restore service-to-service HTTP calls
- **Phase 4**: 
  - Restore monolith writes
  - Resume dual-write pattern
  - Revert to monolith as source-of-truth (1 week restore)

**Rollback time**: < 1 hour (Phase 1-2), < 4 hours (Phase 3), < 1 week (Phase 4)

---

## GO-LIVE DECISION

✅ **RECOMMENDATION: PROCEED WITH FULL MIGRATION**

**Rationale**:
- Clear path to 100% microservices
- Proven patterns (dual-write, events, service mesh)
- Phased approach (low risk per phase)
- Excellent rollback capabilities
- 14-week timeline is aggressive but achievable

**Start Date**: Week of August 7, 2026  
**Completion Target**: October 29, 2026 (14 weeks)  

---

## NEXT STEPS

1. **Week 1 (Aug 7-13)**: 
   - Team review this plan
   - Get sign-offs (tech lead, product, ops)
   - Begin Phase 1A production deployment
   - Start planning Phase 1B work

2. **Week 2 (Aug 14-20)**:
   - Phase 1A production canary (10%)
   - Begin Phase 1B implementation
   - Order Kafka hardware/cloud resources

3. **Week 5 (Sep 4-10)**:
   - Phase 1A production GA (100%)
   - Decommission Phase 1A proxy routes
   - Phase 1B implementation (analytics)

4. **Week 9 (Oct 2-8)**:
   - Phase 1B production GA
   - Kafka cluster ready
   - Phase 3 implementation begins

5. **Week 14 (Nov 6-12)**:
   - Monolith decommissioned
   - **100% Microservices Migration Complete**

---

**Prepared by**: Migration Team  
**Date**: 2026-08-07  
**Status**: READY FOR EXECUTION  
**Confidence**: HIGH  

**Let's complete this migration! 🚀**
