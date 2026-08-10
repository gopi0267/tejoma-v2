# TEJOMA COMPLETE MICROSERVICES MIGRATION
## Comprehensive Specification: 100% Monolith Extraction

**Status**: Ready for Complete Execution  
**Scope**: ALL remaining monolith functionality  
**Timeline**: 6-9 months (full implementation)  
**Target**: 100% microservices, zero monolith business logic  

---

## AUDIT SUMMARY

### Current State (Aug 6, 2026)
- **Monolith**: ~5000 LOC (server.ts + db.ts + 40 route files)
- **Services**: 22 deployed (17 shadow, 5 production)
- **Extracted**: 5 read endpoints (30%)
- **Remaining**: 100+ endpoints, ALL write operations, ALL business logic (70%)

### Complete Component Inventory

**MONOLITH STILL OWNS** (Must Extract):

#### Read Endpoints (35+ total)
- `GET /api/jobs/:id` - Job detail with candidate pool + ranking
- `GET /api/candidates/:id` - Candidate profile
- `GET /api/candidates/:id/resume` - Resume content
- `GET /api/candidates/:id/profile` - Profile details
- `GET /api/candidate-search` - Full-text search (complex join)
- `GET /api/candidate-decisions` - Decision history
- `GET /api/candidate-applications` - Application progress
- `GET /api/recruiter-matches` - Matched candidates
- `GET /api/chat/:threadId` - Chat messages
- `GET /api/chat/threads` - Chat threads list
- `GET /api/skill-intelligence/*` - Skill demand trends
- `GET /api/role-intelligence/*` - Role market analysis
- `GET /api/career-intelligence/*` - Career progression paths
- `GET /api/proficiency-analytics` - Skill proficiency trends
- `GET /api/analytics/dashboard` - Full analytics overview
- `GET /api/ml/model-metrics` - ML model performance
- `GET /api/ml/predictions/*` - ML predictions
- `GET /api/users/:id` - User profile
- `GET /api/companies/:id` - Company profile
- `GET /api/recruiting/stats` - Recruiting statistics
- `GET /api/upload/status/:uploadId` - Upload progress
- `GET /api/resume/parse-status/:jobId` - Resume parse status
- `GET /api/skill-discovery/pending` - Pending skill discovery
- `GET /api/matching/queue/:jobId` - Matching queue status
- ... (10+ more read endpoints)

#### Write Operations (30+ total)
**Swipe/Decision Operations**:
- `POST /api/swipes` - Record candidate swipe
- `PATCH /api/recruiter-review/:id/:id/decision` - Change decision
- `POST /api/recruiter-review/:id/:id/notes` - Add recruiter note
- `DELETE /api/swipes/:id` - Remove swipe

**Candidate Operations**:
- `POST /api/candidates` - Create candidate
- `PUT /api/candidates/:id` - Update candidate
- `DELETE /api/candidates/:id` - Archive candidate
- `POST /api/candidates/:id/profile` - Update profile
- `PUT /api/candidates/:id/profile` - Update profile details
- `POST /api/candidates/:id/resume` - Upload resume
- `DELETE /api/candidates/:id/resume` - Remove resume
- `POST /api/candidates/:id/skills` - Add skills
- `DELETE /api/candidates/:id/skills/:skillId` - Remove skill
- `POST /api/candidates/:id/experiences` - Add experience
- `PUT /api/candidates/:id/experiences/:expId` - Update experience

**Job Operations**:
- `POST /api/jobs` - Create job
- `PUT /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Archive job
- `POST /api/jobs/:id/rerank` - Trigger candidate re-ranking
- `POST /api/jobs/:id/match` - Trigger job matching

**Decision/Application Operations**:
- `POST /api/candidate-decisions` - Record recruiter decision
- `PUT /api/candidate-decisions/:id` - Update decision
- `POST /api/candidate-applications` - Create application
- `PATCH /api/candidate-applications/:id` - Update application status

**Chat Operations**:
- `POST /api/chat` - Create new chat
- `POST /api/chat/:threadId/messages` - Send message
- `PUT /api/chat/:threadId/messages/:msgId` - Edit message
- `DELETE /api/chat/:threadId/messages/:msgId` - Delete message

**Upload Operations**:
- `POST /api/upload` - Start file upload
- `POST /api/upload/:id/chunk` - Upload chunk
- `POST /api/upload/:id/complete` - Finalize upload
- `DELETE /api/upload/:id` - Cancel upload

**User/Company Operations**:
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `POST /api/companies` - Create company
- `PUT /api/companies/:id` - Update company settings

#### Business Logic (All Pure Functions - Safe to Move)

**Matching & Scoring**:
- `scoreJob(job, candidate)` - Main scoring function
- `computeMatchFeatures(job, candidate)` - Feature extraction
- `computeFeatureScore(features)` - Score from features
- `rankCandidatesForJob(jobId)` - Ranking algorithm
- `matchCandidatesToJob(jobId)` - Bulk matching

**Skill & Proficiency**:
- `matchSkillsToJob(skills, jobSkills)` - Skill-job intersection
- `inferSkillProficiency(candidate)` - Proficiency estimation
- `parseSkillsFromResume(resumeText)` - Resume skill extraction
- `discoverUnknownSkills(resumeText)` - New skill discovery

**Career & Role Intelligence**:
- `inferCareerTrajectory(candidate)` - Career path inference
- `estimateSeniority(candidate)` - Seniority level
- `getCompetitiveRoleAnalysis(roleTitle)` - Role market data
- `calculateCareerFitScore(candidate, job)` - Career fit

**Analytics & Recommendations**:
- `computeCandidateAnalytics(candidateId)` - Analytics dashboard
- `generateRecommendations(candidate)` - Skill recommendations
- `calculateRecruiterMetrics(recruiterId)` - Recruiter stats
- `computeInterviewProbability(candidate)` - Interview odds
- `buildCareerIntelligence(candidate)` - Career insights

**Validation & Rules**:
- `validateCandidateProfile(candidate)` - Profile validation
- `validateJobRequirements(job)` - Job requirement validation
- `checkCandidateJobEligibility(candidate, job)` - Eligibility check
- `validateSkillMatch(candidate, job)` - Skill requirement match
- All auth, RBAC, input sanitization rules

#### Database Tables (85 total - 65 still in monolith)

**Monolith Owns** (must be migrated):
- `candidates` - Candidate profiles
- `jobs` - Job listings
- `swipes` - Candidate-job decisions
- `recruiter_notes` - Recruiter feedback
- `candidate_decisions` - Recruiter decisions
- `candidate_applications` - Application status
- `mutual_matches` - Candidate-job mutual interest
- `candidate_profiles` - Extended profile data
- `candidate_experiences` - Work experience
- `candidate_skills` - Skills inventory
- `candidate_educations` - Education history
- `users` - User accounts
- `companies` - Company profiles
- `recruiter_notes` - Recruiter comments
- `chats` - Chat conversations
- `chat_messages` - Chat message history
- `uploads` - File upload records
- `resumes` - Resume documents
- `career_trajectories` - Career path data
- `reasoning_conclusions` - Match reasoning
- `skill_proficiency` - Skill levels
- `role_market_data` - Role intelligence
- `company_requests` - Recruiting requests
- `matching_queue` - Pending matches
- `ml_model_metrics` - ML model performance
- ... (40+ more tables)

**Already Migrated** (in services):
- `candidate_decisions` → candidate-service ✅
- `candidate_application_status` → candidate-service ✅
- `mutual_matches` → matching-decision-service ✅
- `recruiter_review_view` → matching-decision-service (CQRS) ✅
- Various shadow mirrors in services

---

## COMPLETE EXTRACTION ROADMAP

### SPRINT BLOCKS (Each 2-week sprint)

#### Block 1: High-Priority Read Endpoints (Weeks 1-6)

**Sprint 1.1 (Week 1-2)**: Jobs & Candidates Detail
```
Extract:
  - GET /api/jobs/:id (job detail + pool + ranking)
  - GET /api/candidates/:id (candidate profile)
  - GET /api/candidates/:id/resume (resume fetch)
  
Services:
  - job-service (owns jobs, extends from GET /jobs list)
  - candidate-service (owns candidates, extends)
  - resume-service (owns resumes, new internal API)
  
Effort: 40 hours
Dependencies: job-service, candidate-core, matching-scoring, resume-service
```

**Sprint 1.2 (Week 3-4)**: Candidate Search & Applications
```
Extract:
  - GET /api/candidate-search (full-text search, complex join)
  - GET /api/candidate-applications (status tracking)
  - GET /api/candidate-decisions (decision history)
  
Services:
  - candidate-service (owns candidates, search, applications)
  - matching-decision-service (decision history)
  
Effort: 48 hours
Complexity: MEDIUM (search requires ranking, fuzzy match)
```

**Sprint 1.3 (Week 5-6)**: Recruiter Views & Chat
```
Extract:
  - GET /api/recruiter-matches (matched candidates)
  - GET /api/chat/:threadId (chat messages)
  - GET /api/chat/threads (chat thread list)
  
Services:
  - matching-decision-service (recruiter view)
  - chat-service (chat ops, activate from shadow)
  
Effort: 32 hours
```

#### Block 2: Intelligence Services (Weeks 7-12)

**Sprint 2.1 (Week 7-8)**: Skill & Proficiency Intelligence
```
Extract:
  - GET /api/skill-intelligence/* (skill demand, trends)
  - GET /api/proficiency-analytics (skill levels)
  - Skill parsing & discovery functions
  
Services:
  - matching-skill-discovery-service (activate from shadow)
  
Effort: 44 hours
Complexity: MEDIUM (aggregation, trend analysis)
```

**Sprint 2.2 (Week 9-10)**: Role & Career Intelligence
```
Extract:
  - GET /api/role-intelligence/* (role analysis)
  - GET /api/career-intelligence/* (career paths)
  - Role market data computation
  
Services:
  - role-intelligence-service (activate from shadow)
  - career-intelligence-service (activate from shadow)
  
Effort: 40 hours
```

**Sprint 2.3 (Week 11-12)**: Analytics & ML
```
Extract:
  - GET /api/analytics/dashboard (full analytics)
  - GET /api/ml/model-metrics (ML performance)
  - GET /api/ml/predictions/* (predictions)
  
Services:
  - analytics-service (activate from shadow)
  - matching-evaluation-service (activate from shadow)
  
Effort: 44 hours
Complexity: HIGH (aggregation, complex queries)
```

#### Block 3: Write Operations - Phase 1 (Weeks 13-18)

**Sprint 3.1 (Week 13-14)**: Swipe & Decision Writes
```
Extract:
  - POST /api/swipes (write decision)
  - PATCH /api/recruiter-review/:id/:id/decision (change)
  - POST /api/recruiter-review/:id/:id/notes (note)
  
Services:
  - matching-decision-service (owns swipes)
  
Effort: 48 hours
Complexity: HIGH (core business logic, cascading)
Risk: HIGH (most critical path)
Mitigation: Comprehensive testing, A/B parity, saga pattern
```

**Sprint 3.2 (Week 15-16)**: Candidate Profile Writes
```
Extract:
  - POST /api/candidates (new candidate)
  - PUT /api/candidates/:id (update)
  - POST /api/candidates/:id/profile (profile update)
  - POST /api/candidates/:id/skills (add skills)
  - POST /api/candidates/:id/experiences (add experience)
  
Services:
  - candidate-core-service (owns candidates)
  - candidate-service (owns profiles)
  
Effort: 52 hours
Complexity: MEDIUM
```

**Sprint 3.3 (Week 17-18)**: Job Writes
```
Extract:
  - POST /api/jobs (create job)
  - PUT /api/jobs/:id (update job)
  - DELETE /api/jobs/:id (archive)
  - POST /api/jobs/:id/match (trigger matching)
  - POST /api/jobs/:id/rerank (rerank candidates)
  
Services:
  - job-service (owns jobs)
  - matching-scoring-service (ranking)
  
Effort: 44 hours
```

#### Block 4: Write Operations - Phase 2 (Weeks 19-24)

**Sprint 4.1 (Week 19-20)**: Chat & Uploads
```
Extract:
  - POST /api/chat (new chat)
  - POST /api/chat/:threadId/messages (send message)
  - POST /api/upload (start upload)
  - POST /api/upload/:id/chunk (upload chunk)
  - POST /api/upload/:id/complete (finalize)
  
Services:
  - chat-service (chat operations)
  - upload-service (file uploads)
  
Effort: 36 hours
```

**Sprint 4.2 (Week 21-22)**: User & Company Operations
```
Extract:
  - POST /api/users (create user)
  - PUT /api/users/:id (update)
  - POST /api/companies (create company)
  - PUT /api/companies/:id (update)
  - Authentication & RBAC rules
  
Services:
  - identity-service (owns users)
  - platform-governance-service (owns companies)
  
Effort: 40 hours
```

**Sprint 4.3 (Week 23-24)**: Batch & Scheduled Operations
```
Extract:
  - Batch candidate matching
  - Resume parsing pipeline
  - Skill discovery background jobs
  - Analytics aggregation jobs
  - ML model training pipelines
  
Services:
  - jd-parser-service (resume/JD parsing)
  - matching-skill-discovery-service (discovery)
  - dynamic-weighting-service (ML training)
  
Effort: 44 hours
Complexity: HIGH (async, distributed, resilient)
```

#### Block 5: Event-Driven Architecture (Weeks 25-30)

**Sprint 5.1 (Week 25-26)**: Event Bus Implementation
```
Setup:
  - Kafka/RabbitMQ deployment
  - Event schema definition (20+ business events)
  - Event producer framework
  - Event subscriber framework
  
Events to Define:
  - candidate.* (created, updated, deleted)
  - job.* (created, updated, deleted)
  - swipe.* (created, changed)
  - decision.* (made, changed)
  - application.* (created, progressed)
  - chat.* (created, message-added)
  - upload.* (started, completed)
  - user.* (created, updated)
  - skill.* (discovered, proficiency-updated)
  
Effort: 60 hours
```

**Sprint 5.2 (Week 27-28)**: Service Mesh & Tracing
```
Setup:
  - Istio deployment (prod-grade)
  - Jaeger tracing (distributed)
  - Prometheus metrics (existing)
  - Service discovery (K8s native)
  - Traffic policies (canary, circuit-breaker)
  
Effort: 50 hours
```

**Sprint 5.3 (Week 29-30)**: Event Subscribers & Handlers
```
Implement:
  - Event subscribers for all 20+ events
  - Event handlers in each service
  - Compensation logic (saga pattern)
  - Idempotency keys (prevent duplicates)
  - Retry policies
  - Dead-letter queues
  
Effort: 56 hours
```

#### Block 6: Validation & Cutover (Weeks 31-32)

**Sprint 6.1 (Week 31)**: Comprehensive Testing
```
Tests:
  - Unit tests (all pure functions)
  - Integration tests (service-to-service)
  - End-to-end tests (full flows)
  - Parity tests (new vs monolith)
  - Performance tests (1000 req/s+)
  - Chaos tests (failure recovery)
  - Load tests (production load)
  
Effort: 40 hours
```

**Sprint 6.2 (Week 32)**: Final Cutover & Verification
```
Actions:
  - Feature flags to 100% for all services
  - Turn off monolith (maintenance mode)
  - Archive monolith code
  - Verify zero errors (24 hours)
  - Run final validation scripts
  - Declare migration complete
  
Effort: 20 hours
```

---

## DATABASE MIGRATION PLAN

### Current Ownership
| Table | Current Owner | Target Owner | Migration Type |
|-------|---------------|--------------|-----------------|
| candidates | monolith | candidate-core-service | MOVE |
| jobs | monolith | job-service | MOVE |
| swipes | monolith | matching-decision-service | MOVE |
| recruiter_notes | monolith | matching-decision-service | MOVE |
| candidate_profiles | monolith | candidate-service | MOVE |
| candidate_experiences | monolith | candidate-service | MOVE |
| candidate_skills | monolith | candidate-service | MOVE |
| users | monolith | identity-service | MOVE |
| companies | monolith | platform-governance-service | MOVE |
| chats | monolith | chat-service | MOVE |
| chat_messages | monolith | chat-service | MOVE |
| uploads | monolith | upload-service | MOVE |
| resumes | monolith | resume-service | MOVE |
| (50+ more tables) | monolith | various services | MOVE |

### Migration Strategy
1. **Backfill**: Copy all data from monolith to service DB
2. **Dual-write**: Monolith writes go to both databases
3. **Shadow reads**: Services read from mirrors
4. **Validate**: Zero-drift scripts confirm sync
5. **Cutover**: Feature flag routes to service
6. **Archive**: Monolith data kept read-only (fallback)

---

## API CONTRACT GUARANTEES

### Backward Compatibility (MUST MAINTAIN)
- All existing endpoint URLs unchanged
- All response schemas identical
- All query parameters support existing values
- Authentication methods unchanged
- Rate limiting unchanged
- Error codes unchanged
- HTTP status codes same
- Pagination unchanged
- Sorting unchanged
- Filtering unchanged

### No Breaking Changes
- Field names: No changes
- Field types: Coercible only (string→int OK, not reverse)
- Required fields: Cannot become optional
- Optional fields: Can become required (but must default)
- Endpoint removal: Only after 6-month deprecation
- New fields: OK (ignore if unknown)

---

## TESTING STRATEGY

### Unit Tests
- All pure functions
- All business logic
- All validations
- All transformations
- Target: 90%+ coverage

### Integration Tests
- Service-to-service calls
- Database operations
- Event publishing/consuming
- Cache invalidation
- Dual-write consistency

### End-to-End Tests
- Full request paths (nginx → gateway → service → DB)
- All read endpoints (vs monolith)
- All write endpoints (vs monolith)
- Feature flag toggles
- Rollback procedures

### Performance Tests
- Load: 1000 req/s per endpoint
- Stress: Beyond 1000 req/s (find breaking point)
- Soak: 24-hour sustained load
- Spike: Sudden traffic increase

### Parity Tests
- Service response == Monolith response (JSON deep-equal)
- Same latency profile
- Same error handling
- Same pagination behavior

### Chaos Tests
- Kill services (verify fallback)
- Fill databases (verify bounds)
- Fail networks (verify retry)
- Poison events (verify dead-letter)
- Corrupt data (verify detection)

---

## MONITORING & OBSERVABILITY

### Metrics
- Request rate (req/s per endpoint)
- Latency (p50, p95, p99)
- Error rate (%)
- HTTP status code distribution
- Database query performance
- Cache hit rate
- Event processing lag
- Service dependency health

### Logging
- Structured JSON (Pino format)
- Correlation IDs (trace requests)
- Request/response logging
- Event logging
- Error logging with stack traces

### Tracing
- Distributed tracing (Jaeger)
- Request flow visualization
- Latency breakdown by service
- Error root-cause analysis

### Alerting
- Error rate > 1% (critical)
- Latency p99 > 1000ms (critical)
- Service down (critical)
- Event lag > 5 minutes (warning)
- Database connections > 80% (warning)

---

## ROLLBACK PROCEDURES

### Instant Rollback (< 1 minute)
1. Flip feature flag to FALSE
2. Restart api-gateway
3. Traffic reverts to monolith
4. Monitor error rate (should drop in 60 seconds)

### Data Rollback (if drift detected)
1. Stop dual-writes (DUAL_WRITE_ENABLED=false)
2. Re-run backfill script
3. Verify zero drift (validation scripts)
4. Resume dual-writes

### Service Rollback (if deployment fails)
1. kubectl rollout undo deployment/service-name
2. Verify service health
3. Resume traffic (feature flag)

---

## FINAL DELIVERABLES

### At Completion
✅ 100% of monolith functionality migrated
✅ All services production-ready
✅ All tests passing (unit, integration, E2E, performance, chaos)
✅ All APIs cut over (no monolith in critical path)
✅ All data migrated (monolith is archive-only)
✅ All monitoring active
✅ All alerting configured
✅ Complete documentation
✅ Runbooks for all procedures
✅ Incident response plans
✅ Zero technical debt from migration

### Migration Report
- List of all services created/activated
- List of all endpoints migrated
- Database ownership map
- Dependency graph
- Architecture diagrams
- Test results (coverage %, pass rate)
- Performance benchmarks
- Rollback testing results
- Risks and learnings
- **Final completion percentage: 100%**

---

## EXECUTION TIMELINE

```
Phase 1: Read Endpoints (12 weeks)
  ├─ Weeks 1-2: High-priority detail endpoints
  ├─ Weeks 3-4: Search & applications
  ├─ Weeks 5-6: Recruiter views & chat
  ├─ Weeks 7-8: Skill intelligence
  ├─ Weeks 9-10: Role & career intelligence
  └─ Weeks 11-12: Analytics & ML

Phase 2: Write Operations (12 weeks)
  ├─ Weeks 13-14: Swipe & decision writes
  ├─ Weeks 15-16: Candidate profile writes
  ├─ Weeks 17-18: Job writes
  ├─ Weeks 19-20: Chat & uploads
  ├─ Weeks 21-22: User & company operations
  └─ Weeks 23-24: Batch & scheduled jobs

Phase 3: Event-Driven Architecture (6 weeks)
  ├─ Weeks 25-26: Event bus
  ├─ Weeks 27-28: Service mesh & tracing
  └─ Weeks 29-30: Event subscribers

Phase 4: Final Validation & Cutover (2 weeks)
  ├─ Week 31: Comprehensive testing
  └─ Week 32: Final cutover & verification

TOTAL: 32 weeks (8 months)
```

---

## SUCCESS CRITERIA

✅ All read endpoints migrated  
✅ All write operations migrated  
✅ All business logic extracted  
✅ All databases have single owner  
✅ Zero service dependencies on monolith  
✅ All tests passing (100%)  
✅ Performance equal or better  
✅ Zero drift in data (validation scripts)  
✅ All services independently deployable  
✅ Monolith completely decommissioned  
✅ **MIGRATION COMPLETE: 100%**  

---

**Status**: READY FOR EXECUTION
**Owner**: Platform Engineering
**Next Action**: Begin Sprint 1.1 (Week 1)
**Expected Completion**: 32 weeks from start
