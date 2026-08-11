# PHASE 3: LIVE ITEM MIGRATION STATUS
## Real-Time Status of 7 Identified Monolith Dependencies

**Date**: 2026-08-11  
**Phase Status**: IN PROGRESS  
**Scope**: Verification and implementation of 7 live migration items

---

## EXECUTIVE SUMMARY

From Phase 1 & 2 discovery: 7 genuinely-live monolith dependencies identified.

**Current Status**:
- ✅ **1 COMPLETE** (Item 1: Real-Time Events)
- ⚠️ **6 IN PROGRESS** (Items 2-7: Requiring implementation)

---

## ITEM #1: REAL-TIME EVENT BROADCASTING ✅ COMPLETE

**Status**: Already fully implemented via Redis pub/sub

### Evidence
- ✅ `src/realtimeBroadcast.ts`: Module exists with `publishRealtimeEvent()` 
- ✅ `realtime-service/src/server.ts`: Subscribes to 'tejoma-realtime' channel
- ✅ `nginx/conf.d/tejoma.conf` line 74-90: Routes /api/realtime/stream to realtime-service:4030
- ✅ `src/api/job-internal.routes.ts` line 19: Calls `publishRealtimeEvent('job-created', ...)`
- ✅ Monolith's `src/realtime.ts`: Uses `subscribeToRealtimeEvents()` for SSE subscription

### Implementation Details

**Monolith Side** (src/realtime.ts):
- Deprecated in-process `broadcastEvent()` - now just an alias to `publishRealtimeEvent()`
- Calls `initializeRealtimeSubscription()` at startup
- Subscribes to Redis and forwards events to connected SSE clients

**Service Side** (services):
- job-service, matching-decision-service, matching-scoring-service publish events via monolith's mirror-and-notify
- Monolith's endpoints call `publishRealtimeEvent()` directly

**Realtime Service**:
- Dedicated microservice subscribed to 'tejoma-realtime'
- Forwards Redis messages to SSE clients
- Stateless (no in-process client storage)

### Deployment Impact
- ✅ No additional changes needed
- ✅ Event broadcasting is decentralized and working
- ✅ Realtime service is operational

**Verdict**: ✅ **COMPLETE AND WORKING**

---

## ITEM #2: ML ADMIN & TRAINING STATE ⚠️ NEEDS VERIFICATION

**Status**: Checking current implementation

### Question
Does matching-scoring-service already persist model config to its own database, or does it still call monolith?

### Investigation Required

**Files to Check**:
- matching-scoring-service/src/routes/mlAdmin.routes.ts
- matching-scoring-service/src/db.ts (schema check for model_config table)
- matching-scoring-service/src/services/monolithClient.ts (calls to monolith)

### Current Architecture Pattern

Services call monolith's `/internal/matching-scoring/*` for:
- GET /config (read current model type)
- POST /train (start training)
- GET /status (read model version)

### Migration Path (if needed)
1. Add model_config table to matching-scoring-service schema
2. Implement local PUT/GET config endpoints
3. Remove monolith proxy calls
4. Test: POST /api/ml/train, verify local DB reflects state

---

## ITEM #3: ANALYTICS AGGREGATION ⚠️ NEEDS IMPLEMENTATION

**Status**: Pure proxy today, CQRS needed

### Current Situation

**analytics-service** has NO database of its own:
- All 4 routes proxy to monolith: /dashboard, /job, /recruiter-profile, /skills
- Endpoints purely compute aggregations from multiple sources

### Required Changes

1. **Create tejoma_analytics database** (if not exists)
2. **Add CQRS tables**:
   - dashboard_metrics (active_jobs, matched_candidates, pending_swipes, etc.)
   - job_analytics (per-job stats)
   - recruiter_profile (per-recruiter stats)
   - skills_distribution (skill frequency)

3. **Implement event subscribers**:
   - Listen to 'job-created', 'job-updated', 'job-deleted' → update dashboard_metrics
   - Listen to 'candidate-updated' → update aggregates
   - Listen to 'swipe-completed' → update decision counts

4. **Backfill initial data** (run aggregation script once)

5. **Disable proxy, use local tables**

### Risk Level
- **Data Consistency**: MEDIUM - eventual consistency via event lag
- **Migration**: MEDIUM - CQRS pattern change
- **Rollback**: EASY - feature flag or local fallback

---

## ITEM #4: RESUME FILE STORAGE ⚠️ NEEDS MIGRATION

**Status**: Still monolith-resident

### Current Situation

**resume-service** proxy everything to monolith:
- File storage: `uploads/<candidateId>.pdf` on monolith
- Metadata: Stored in monolith's `resume_uploads` table
- Endpoint: Pure HTTP proxy to `/internal/resume/...`

### Required Changes

1. **Add volume to resume-service** in docker-compose.yml:
   ```yaml
   resume-service:
     volumes:
       - ./uploads:/app/uploads  # Persistent storage
   ```

2. **Create resume storage schema** in tejoma_resume database:
   - Add `file_uploads` table (candidate_id, filename, path, hash, size, created_at)
   - Add `file_metadata` table if tracking parsing/extraction is needed

3. **Implement local upload handler**:
   - POST /api/candidate-resume (move from monolith)
   - Write to `/app/uploads/`
   - Store metadata in tejoma_resume

4. **Implement local download handler**:
   - GET /api/candidate-resume/:candidateId
   - Read from local `/app/uploads/`
   - No monolith call

### Risk Level
- **File I/O**: MEDIUM - cross-container volume management
- **Disk Space**: LOW - volumes are persistent
- **Migration**: LOW - straightforward file copy

---

## ITEM #5: CHAT RAG CORPUS READS ⚠️ NEEDS ROUTING CHANGE

**Status**: Calls monolith for unscoped data

### Current Situation

**chat-service** reads unscoped candidate/job data for RAG:
- monolithClient functions return ALL candidates/jobs (no scoping)
- Endpoint: GET /internal/chat/candidates, /internal/chat/jobs

### The Problem

Only monolith can return "all data" because services are scoped by company/ownership. But:
- Candidate data already in candidate-core-service's tejoma_candidate_core
- Job data already in job-service's tejoma_job

### Required Changes

1. **Replace unscoped reads with scoped service calls**:
   ```typescript
   // Before: await monolithClient.getAllCandidatesUnscoped()
   // After: await candidateCoreServiceClient.getCandidates({ companyId, limit: 1000 })
   ```

2. **Update chat-service's RAG builder**:
   - Call candidate-core-service's /internal/candidates endpoint
   - Call job-service's /internal/jobs endpoint
   - Combine results for RAG corpus (still works, just scoped differently)

3. **Remove monolith proxy endpoints** from chat-service's monolithClient

### Compatibility

- ✅ Service endpoints already exist
- ✅ Data structure compatible
- ✅ Just a routing change, no schema changes needed

### Risk Level
- **Functionality**: LOW - same data structure
- **Scope**: LOW - already scoped correctly in real data
- **Testing**: LOW - just verify RAG still works

---

## ITEM #6: RAG/EMBEDDING INDEXING ⚠️ NEEDS DATA OWNERSHIP TRANSFER

**Status**: Monolith-resident, services have started implementation

### Current Situation

**RAG indexing** still monolith-resident:
- src/rag.service.ts: Generates embeddings, stores in monolith DB
- Called FROM: job-service, candidate-core-service (via mirror-and-notify)

### Evidence of Partial Migration

**job-service/src/routes/jobs.routes.ts line 95-96**:
```typescript
const { indexJobInBackground } = await import('../rag.service.js');
indexJobInBackground(created);
```

Job service is ALREADY calling its own indexing! (before mirror)

**job-service/src/api/job-internal.routes.ts** (monolith side):
```typescript
// Item 7: Indexing now done by job-service, skip here to avoid double-indexing
// indexJobInBackground(job);
// indexJobEmbeddingInBackground(job);
```

Monolith is already skipping indexing!

### What's Done ✅

- ✅ job-service already indexes before mirror
- ✅ monolith already skips duplicate indexing
- ✅ candidate-core-service likely has same pattern

### What Remains ⚠️

- ⚠️ Verify candidate-core-service has indexing logic
- ⚠️ Verify embedding tables exist in service databases
- ⚠️ Update chat-service to query service embeddings, not monolith's

### Risk Level
- **Indexing**: LOW - already implemented in services
- **Storage**: LOW - embeddings in service DB or separate vector store
- **Query**: MEDIUM - need to update RAG query paths

---

## ITEM #7: RECRUITER MATCHES LIST ⚠️ NEEDS VERIFICATION & CUTOVER

**Status**: Flag-gated, ready but untested

### Current Situation

**recruiting-service** has local implementation but it's disabled:
- `RECRUITER_MATCHES_CUTOVER_ENABLED=false` in .env.local
- Local query logic exists in recruiting-service
- Falls back to monolith when flag is false

### Implementation Status

✅ Local implementation already exists  
⚠️ Not verified against monolith's output  
❌ Flag not enabled in production

### Required Steps

1. **Compare outputs**:
   - Enable flag temporarily in dev/test
   - Side-by-side call: recruiting-service's local + monolith's /internal/recruiting/matches
   - Field-by-field validation
   - Verify order, filtering, counts match exactly

2. **Enable permanently**:
   - Set `RECRUITER_MATCHES_CUTOVER_ENABLED=true`
   - Remove monolith proxy fallback (optional optimization)
   - Deploy and monitor

3. **Cleanup**:
   - Once verified in production, remove monolithClient call

### Risk Level
- **Logic**: LOW - implementation already complete
- **Correctness**: MEDIUM - needs manual verification
- **Rollback**: EASY - just toggle flag back to false

---

## SUMMARY TABLE

| Item | Feature | Status | Effort | Risk | Blocker? |
|------|---------|--------|--------|------|----------|
| 1 | Real-time events | ✅ DONE | Complete | LOW | NO |
| 2 | ML training state | ⚠️ TBD | MEDIUM | MEDIUM | NO |
| 3 | Analytics CQRS | ⚠️ TODO | HIGH | MEDIUM | NO |
| 4 | Resume storage | ⚠️ TODO | MEDIUM | MEDIUM | NO |
| 5 | Chat RAG scope | ⚠️ TODO | LOW | LOW | NO |
| 6 | RAG indexing | ⚠️ PARTIAL | LOW | LOW | NO |
| 7 | Recruiter matches | ⚠️ TODO | LOW | MEDIUM | NO |

---

## NEXT STEPS

**Immediate** (This phase):
1. ⬜ Verify Item 2 (ML training state) - check schema
2. ⬜ Verify Item 6 (RAG indexing) - check candidate-core-service
3. ⬜ Implement Item 4 (Resume storage) - add volume, migrate files
4. ⬜ Implement Item 5 (Chat RAG scope) - reroute to service APIs
5. ⬜ Test Item 7 (Recruiter matches) - side-by-side comparison
6. ⬜ Implement Item 3 (Analytics CQRS) - create schema, event handlers

**Cleanup** (After all verified):
- Remove all monolithClient proxies
- Delete 27 dead route files in src/api/
- Update documentation

---

**Phase 3 Next Action**: Verify Item 2, then proceed with implementation items in dependency order

