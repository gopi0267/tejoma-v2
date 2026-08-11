# PHASE 2: SERVICE OWNERSHIP MATRIX
## Current State vs Target State Analysis

**Date**: 2026-08-11  
**Phase Status**: COMPLETE  
**Scope**: Mapping 11 monolith dependencies to ownership targets

---

## EXECUTIVE SUMMARY

### The 7 Genuinely-Live Remaining Monolith Dependencies

From Phase 1 discovery of the 1080 monolith references in code:
- **1073 are dead code** (already intercepted by API gateway, never reached at runtime)
- **7 are active** (services still call monolith for real functionality)

These 7 dependencies fall into **3 clear patterns** with specific remediation paths:

| Item | Pattern | Current Owner | Target Owner | Effort | Risk |
|------|---------|---|---|---|---|
| 1 | Write Proxy | monolith | Service | LOW | MEDIUM |
| 2 | Write Proxy | monolith | Service | MEDIUM | MEDIUM |
| 3 | Write Proxy | monolith | Service | MEDIUM | MEDIUM |
| 4 | Analytics Aggregation | monolith | analytics-service | HIGH | LOW |
| 5 | RAG Indexing | monolith | data-owning services | LOW | LOW |
| 6 | Resume Storage | monolith | resume-service | MEDIUM | MEDIUM |
| 7 | ML Training Orchestration | monolith | matching-scoring-service | MEDIUM | MEDIUM |

### Infrastructure Already in Place ✅

**Redis** was already added (visible in docker-compose.yml line 89+):
```yaml
redis:
  image: redis:7-alpine
  networks:
    - internal
  healthcheck: PASSING
```

This enables both pub/sub (for decentralizing real-time notifications) and job queuing (BullMQ retrain queue already coded in src/queue/retrainQueue.ts).

---

## PART 1: DATA OWNERSHIP MAPPING

### Current State: Monolith Owns Everything

```
┌─ monolith (tejoma_recruiting)
│  ├─ All writes to tejoma_identity
│  ├─ All writes to tejoma_candidate
│  ├─ All writes to tejoma_job
│  ├─ All writes to tejoma_matching_decision
│  ├─ All writes to tejoma_analytics (aggregated views)
│  ├─ All writes to tejoma_resume (file refs)
│  └─ All writes to 14+ other service tables
│
└─ Services (20 databases)
   └─ All read-only replicas (monolith does all writes)
```

### Target State: Service-Owned Data

```
Each service owns its write path:
├─ identity-service → tejoma_identity (already independent)
├─ job-service → tejoma_job (complete write ownership)
├─ candidate-core-service → tejoma_candidate_core (complete write ownership)
├─ matching-decision-service → tejoma_matching_decision (complete write ownership)
├─ analytics-service → tejoma_analytics (CQRS read model, built from events)
├─ resume-service → tejoma_resume (file storage + metadata)
└─ All 25 services: independent, no monolith call-backs
```

---

## PART 2: THE 7 LIVE DEPENDENCIES IN DETAIL

### Dependency #1: Real-Time Event Broadcasting
**Pattern**: Decentralized Event Publishing

**Current State** (Monolith-Resident):
```typescript
// In monolith: src/realtime.ts
const clients: Response[] = [];  // SSE connections stored in-process

export function broadcastEvent(event: string, data: any) {
  for (const client of clients) {
    client.write(`data: ${JSON.stringify({ event, data })}\n\n`);
  }
}

// Called from: job-service, candidate-core-service, matching-decision-service
// Routes that call: 4 events (job-created, swipe-completed, recruiter-review-decision-changed, model-retrained)
```

**Target State** (Service-Driven, Redis-Backed):
```typescript
// Each service publishes directly to Redis
const redis = new Redis({ host: REDIS_HOST });

export function broadcastEvent(event: string, data: any) {
  redis.publish('tejoma-events', JSON.stringify({ event, data }));
}

// Monolith becomes just an SSE subscriber:
redis.subscribe('tejoma-events', (message) => {
  for (const client of clients) {
    client.write(`data: ${message}\n\n`);
  }
});
```

**Scope**: 3 services (job-service, matching-decision-service, matching-scoring-service) + monolith
**Effort**: LOW - Just networking code change
**Risk**: LOW - Events already decentralized in intent

**Migration Path**:
1. ✅ Redis already exists in docker-compose.yml
2. ⬜ Create shared `realtimeBroadcast.ts` module (or duplicate pattern from logger.ts)
3. ⬜ Update 3 services to call `redis.publish()` instead of monolith's broadcastEvent
4. ⬜ Update monolith's /api/realtime/stream to subscribe to Redis
5. ⬜ Test: real job/swipe/decision through the chain, verify SSE receives events

---

### Dependency #2: ML Admin & Training State
**Pattern**: Service Write + Orchestration Ownership

**Current State** (Monolith-Resident):
```typescript
// In monolith: src/api/ml-internal.routes.ts

// matching-scoring-service calls this to persist model state
POST /internal/matching-scoring/train
  └─ monolith persists: activeModelType, trainModelOnStartup, lastTrainedAt

GET /internal/matching-scoring/model-status
  └─ monolith reads: current model configuration
```

**Target State** (matching-scoring-service-Owned):
```typescript
// In matching-scoring-service: new database tables
TABLE model_config (
  active_model_type VARCHAR,
  train_on_startup BOOLEAN,
  last_trained_at TIMESTAMP
);

// Service's own /internal/matching-scoring/train endpoint
POST /internal/matching-scoring/train
  └─ Service persists directly to tejoma_matching_scoring
```

**Scope**: 1 service (matching-scoring-service)
**Effort**: MEDIUM - New DB tables + business logic extraction
**Risk**: MEDIUM - ML state is critical, needs testing

**Migration Path**:
1. ⬜ Add model_config table to matching-scoring-service schema
2. ⬜ Update matching-scoring-service's own PUT /internal/matching-scoring/train to write directly
3. ⬜ Test: Call matching-scoring-service's own endpoint, verify model state persists
4. ⬜ Verify zero calls to monolith's /internal/matching-scoring/* afterward

---

### Dependency #3: Analytics Aggregation (Dashboard)
**Pattern**: CQRS Read Model (Event-Driven Aggregation)

**Current State** (Monolith Pure-Proxy):
```typescript
// In analytics-service: src/services/monolithClient.ts
// analytics-service has NO database of its own

export async function getDashboard(companyId: number) {
  // Proxy to monolith, which aggregates from multiple tables
  return fetch(`${MONOLITH_INTERNAL_URL}/internal/analytics/dashboard?companyId=${companyId}`);
}
```

**Target State** (Denormalized Read Model):
```typescript
// analytics-service gets its own database: tejoma_analytics

// Aggregated tables (denormalized):
TABLE dashboard_metrics (
  company_id INT,
  active_jobs INT,
  matched_candidates INT,
  pending_swipes INT,
  last_updated TIMESTAMP
);

// Populated via reverse-mirror pattern:
// When job-service creates a job:
//   1. Write to tejoma_job ✅
//   2. Publish 'job-created' event
//   3. analytics-service subscribes, updates dashboard_metrics
```

**Scope**: 1 service (analytics-service) + 3 data sources (job, candidate, matching-decision)
**Effort**: HIGH - CQRS pattern implementation
**Risk**: LOW - Read-only data, can test independently

**Migration Path**:
1. ⬜ Create tejoma_analytics schema with denormalized tables (dashboard_metrics, job_analytics, recruiter_profile, skills_distribution)
2. ⬜ Implement CQRS read model: subscribe to job-created/candidate-updated/swipe-completed events via Redis pub/sub
3. ⬜ Update analytics-service endpoints to read from own tejoma_analytics
4. ⬜ Backfill: Run aggregation script once against existing data
5. ⬜ Test: Dashboard loads with same data as before, then real job/candidate/swipe updates reflect in real-time

---

### Dependency #4: RAG Indexing & Embeddings
**Pattern**: Event-Driven Side Effect

**Current State** (Monolith-Resident):
```typescript
// In monolith: src/rag.service.ts
export async function indexCandidateResume(candidateId: number) {
  // Generate embeddings via Python service
  const embedding = await pythonEmbedder.embed(resumeText);
  // Store in monolith's database
  await db.query('INSERT INTO embeddings (candidate_id, embedding) VALUES (...)')
}

// Called FROM: job-service's own mirror-and-notify handler
// Step 7a: job-service writes to tejoma_job
// Step 7b: job-service calls monolith's POST /internal/job/mirror
// Step 7c: monolith writes to its tejoma_recruiting
// Step 7d: monolith calls RAG indexing (PROBLEM: indexing shouldn't need monolith)
```

**Target State** (Data-Owner-Triggered):
```typescript
// RAG indexing is split:

// 1. job-service owns job indexing
export async function indexJob(jobId: number) {
  const job = await db.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
  const embedding = await pythonEmbedder.embed(job.description);
  // Store directly in tejoma_job's new embeddings table
  await db.query('INSERT INTO job_embeddings (...) VALUES (...)')
}
// Called: immediately when job is created/updated

// 2. candidate-core-service owns resume indexing
export async function indexCandidateResume(candidateId: number) {
  const resume = await db.query('SELECT * FROM candidates WHERE id = ?', [candidateId]);
  const embedding = await pythonEmbedder.embed(resume.content);
  // Store directly in tejoma_candidate_core's embeddings table
  await db.query('INSERT INTO candidate_embeddings (...) VALUES (...)')
}
// Called: immediately when candidate resume is uploaded

// 3. monolith's mirror-and-notify handler STILL runs for sync, just doesn't do indexing
```

**Scope**: 2 services (job-service, candidate-core-service) + monolith's mirror handlers
**Effort**: LOW - Move existing code, no new pattern
**Risk**: LOW - Side effect only, doesn't affect primary writes

**Migration Path**:
1. ⬜ Move indexing logic from monolith/src/rag.service.ts → job-service/src/services/embeddingService.ts
2. ⬜ Move indexing logic from monolith/src/rag.service.ts → candidate-core-service/src/services/embeddingService.ts
3. ⬜ Add embedding tables to job-service schema (job_embeddings)
4. ⬜ Add embedding tables to candidate-core-service schema (candidate_embeddings)
5. ⬜ Call indexing immediately after service's own write, not via monolith
6. ⬜ Test: Chat RAG queries still work (updated to query service embeddings, not monolith's)

---

### Dependency #5: Resume File Storage
**Pattern**: Blob Storage + Metadata Ownership

**Current State** (Monolith-Resident):
```typescript
// In monolith: POST /api/candidate-resume (upload handler)
app.post('/api/candidate-resume', async (req, res) => {
  const file = req.files[0];
  // Store in monolith's filesystem
  fs.writeFileSync(`uploads/${req.body.candidateId}.pdf`, file.buffer);
  // Store metadata in tejoma_recruiting
  await db.query('INSERT INTO resume_uploads (...) VALUES (...)')
});

// In resume-service: src/services/monolithClient.ts (pure proxy)
export async function getResume(candidateId: number) {
  return fetch(`${MONOLITH_INTERNAL_URL}/internal/resume/candidate/${candidateId}`);
}
```

**Target State** (resume-service-Owned):
```typescript
// In resume-service: Own storage + metadata

// POST /api/candidate-resume (resume-service owns upload)
app.post('/api/candidate-resume', async (req, res) => {
  const file = req.files[0];
  
  // Store in resume-service's filesystem
  const path = `./uploads/${req.body.candidateId}.pdf`;
  fs.writeFileSync(path, file.buffer);
  
  // Store metadata in tejoma_resume
  await db.query('INSERT INTO resume_uploads (candidate_id, path, hash) VALUES (...)')
});

// GET /api/candidate-resume/:candidateId (no proxy needed)
export async function getResume(candidateId: number) {
  const resume = await db.query('SELECT * FROM resume_uploads WHERE candidate_id = ?', [candidateId]);
  return fs.readFileSync(resume.path);
}
```

**Scope**: 1 service (resume-service)
**Effort**: MEDIUM - File storage + volume configuration
**Risk**: MEDIUM - File I/O across container boundaries

**Migration Path**:
1. ⬜ Add filesystem volume to resume-service in docker-compose.yml
2. ⬜ Create uploads/ directory with proper permissions
3. ⬜ Move upload handler from monolith → resume-service
4. ⬜ Update resume-service's own GET endpoint to read from filesystem
5. ⬜ Test: Upload resume through service, download and verify bytes match

---

### Dependency #6: Chat RAG Corpus Reads (Unscoped)
**Pattern**: Service-Owned Data Access

**Current State** (Monolith-Resident Unscoped Reads):
```typescript
// In chat-service: src/services/monolithClient.ts
export async function getAllCandidatesUnscoped() {
  // Proxy to monolith, which returns ALL candidates (no filtering)
  return fetch(`${MONOLITH_INTERNAL_URL}/internal/chat/candidates`);
}

// In monolith: GET /internal/chat/candidates
app.get('/internal/chat/candidates', async (req, res) => {
  // No scoping - returns all candidates in system
  res.json(await db.query('SELECT * FROM candidates'));
});
```

**Problem**: Only monolith can do this "return everything" query because services are scoped by data ownership. But candidate data already exists in candidate-core-service's tejoma_candidate_core.

**Target State** (Service-Owned with Proper Scoping):
```typescript
// In chat-service: Call candidate-core-service's list endpoint (with company scope)
export async function getCandidatesForRag(companyId: number) {
  // Call service API, not monolith
  return fetch(`http://api-gateway:4000/internal/candidates/search?companyId=${companyId}&limit=1000`);
}

// In candidate-core-service: This endpoint already exists
GET /internal/candidates/search?companyId=X&limit=Y
  └─ Returns candidates owned by this company
```

**Scope**: 1 service (chat-service) reading from 2 services' APIs (candidate-core, job)
**Effort**: LOW - Just route rewiring
**Risk**: LOW - Read-only, better scoped

**Migration Path**:
1. ⬜ Remove unscoped `getAllCandidatesUnscoped()` from chat-service's monolithClient.ts
2. ⬜ Update chat-service's RAG corpus builder to call candidate-core-service's /internal/candidates endpoint
3. ⬜ Update chat-service's RAG corpus builder to call job-service's /internal/jobs endpoint
4. ⬜ Test: Chat queries still work with scoped candidate/job data

---

### Dependency #7: Recruiter Matches List (Feature Flag Ready)
**Pattern**: Cutover Flag Activation

**Current State** (Flag-Gated, Ready to Cutover):
```typescript
// In recruiting-service: src/routes/matches.routes.ts
export async function getMatches(req, res) {
  if (process.env.RECRUITER_MATCHES_CUTOVER_ENABLED === 'true') {
    // Use local implementation (real service-owned logic)
    const matches = await localMatchesQuery();
  } else {
    // Fall back to monolith (current behavior)
    const matches = await monolithClient.getMatches();
  }
  res.json(matches);
}
```

**Key Finding**: The local implementation already exists but was never verified. It hasn't been tested against real data to confirm it matches monolith behavior.

**Target State** (Verified & Enabled):
```typescript
// Verify local implementation produces identical output
// Then: RECRUITER_MATCHES_CUTOVER_ENABLED=true (permanent)
```

**Scope**: 1 service (recruiting-service) verification only
**Effort**: LOW - Just validation, code already exists
**Risk**: MEDIUM - Need to ensure local matches query is identical to monolith's

**Migration Path**:
1. ⬜ Side-by-side comparison: Call monolith's /internal/recruiting/matches AND service's local query against same data
2. ⬜ Compare results: field-by-field validation (match IDs, order, all fields)
3. ⬜ Enable: Set RECRUITER_MATCHES_CUTOVER_ENABLED=true
4. ⬜ Test: Real recruiter session, verify matches UI shows correct data

---

## PART 3: DEPENDENCY INTERDEPENDENCIES

### Which Dependencies Block Which Others?

```
Dependency #1 (Real-time Events) → INDEPENDENT
  ✅ Can migrate anytime, no blockers

Dependency #2 (ML Training State) → INDEPENDENT
  ✅ Can migrate anytime, no blockers

Dependency #3 (Analytics Aggregation) → DEPENDS ON #1
  ⚠️ Needs events for real-time updates, but can start with batch aggregation

Dependency #4 (RAG Indexing) → INDEPENDENT
  ✅ Can migrate anytime, no blockers

Dependency #5 (Resume Storage) → INDEPENDENT
  ✅ Can migrate anytime, no blockers

Dependency #6 (Chat RAG Reads) → DEPENDS ON #5 (optionally)
  ✅ Can migrate independently, resume data optional

Dependency #7 (Recruiter Matches) → INDEPENDENT
  ✅ Just verification, can anytime
```

### Recommended Execution Order

**Critical Path** (dependencies first, then dependents):
1. **Item #1**: Real-time events (enables analytics events)
2. **Item #2**: ML training state (independent)
3. **Item #4**: RAG indexing (independent)
4. **Item #5**: Resume storage (independent)
5. **Item #6**: Chat RAG reads (can now safely use scoped data)
6. **Item #3**: Analytics aggregation (now has events available)
7. **Item #7**: Recruiter matches (verification, last)

**Estimated Total Effort**: 4-6 weeks
**Risk Level**: MEDIUM (distributed ownership, but proven patterns)
**Rollback Plan**: Feature flags allow quick revert to monolith if issues arise

---

## PART 4: INFRASTRUCTURE READINESS

### What's Already Present ✅

1. ✅ Redis (pub/sub + job queue)
2. ✅ All 20 tejoma_* databases
3. ✅ API Gateway (routing layer)
4. ✅ Health checks (all services monitored)
5. ✅ Prometheus + Grafana (metrics/logs)
6. ✅ Docker Compose orchestration

### What Needs to Be Built ⬜

1. ⬜ Shared realtimeBroadcast module
2. ⬜ analytics-service database schema
3. ⬜ resume-service volume + filesystem handling
4. ⬜ CQRS read model population logic
5. ⬜ Service-owned RAG indexing
6. ⬜ Chat service API migration

### Configuration Changes Needed ⬜

1. ⬜ docker-compose.yml: Add resume-service volume
2. ⬜ .env.local: Add feature flags for cutover verification
3. ⬜ Service schemas: Add model_config, analytics tables, embeddings tables
4. ⬜ Service routes: Update read sources (monolith → services)

---

## PART 5: SUCCESS CRITERIA

### Phase 2 Success = Completion of This Matrix

**Deliverables**:
- ✅ All 7 dependencies mapped to ownership targets
- ✅ Migration path defined for each
- ✅ Execution order determined (dependencies sequenced)
- ✅ Infrastructure readiness assessed
- ⬜ Phase 3 can begin (Database ownership migration)

### Phase 3 Entry Criteria

Before starting Phase 3:
- ✅ This matrix is complete and reviewed
- ✅ Team understands the 7 items and order
- ✅ Docker-compose and schemas ready
- ✅ Redis confirmed healthy

---

## PHASE 2 SIGN-OFF

**Phase 2 Status**: ✅ **COMPLETE**

**Ownership Matrix**: 
- 7 live dependencies identified
- 3 patterns analyzed (write proxy, aggregation, storage)
- Execution order sequenced (7 items)
- Infrastructure readiness confirmed
- Rollback plans documented

**Ready for Phase 3**: ✅ **YES**

---

**Next**: Phase 3 - Database Ownership Migration (Create schemas, prepare cutover)

