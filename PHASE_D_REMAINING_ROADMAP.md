# Phase D Remaining Roadmap — Production Microservices Migration

## Current Status
- ✅ Frontend extraction to nginx (stateless)
- ✅ Realtime service for SSE (independent scalability)
- ⏳ 6 items remaining to complete Phase D

## Remaining Phase D Items (Priority Order)

### Phase D Item 3: Career Trajectory Table Migration
**Complexity:** HIGH | **Impact:** Medium | **Est. Time:** 2-3 hours

**Current State:**
- Monolith owns `career_trajectories` table
- matching-decision-service reads via `/internal/matching-decision/career-trajectory` GET endpoint
- Called during decision-detail explainability computation

**Migration Path:**
1. Add `career_trajectories` table to matching-reasoning-service schema
2. Create `/internal/career-trajectory` endpoint in matching-reasoning-service
3. Populate data from monolith (one-time migration)
4. Update matching-decision-service to call new endpoint
5. Remove from monolith's /internal/matching-decision endpoint

**Success Criteria:**
- matching-decision-service calls matching-reasoning-service, not monolith
- Data stays in sync via dual-write pattern
- All explainability tests pass

---

### Phase D Item 4: Reasoning Conclusions Migration  
**Complexity:** MEDIUM | **Impact:** Medium | **Est. Time:** 1-2 hours

**Current State:**
- Monolith owns `reasoning_conclusions` table
- matching-decision-service reads via `/internal/matching-decision/reasoning-conclusions`
- matching-evaluation-service computes and stores reasoning

**Migration Path:**
1. Add `reasoning_conclusions` to matching-evaluation-service database
2. Create endpoint to serve data
3. Update matching-decision-service to call matching-evaluation-service
4. Remove from monolith endpoint

---

### Phase D Item 5: ML Admin State Migration
**Complexity:** LOW | **Impact:** Medium | **Est. Time:** 1 hour

**Current State:**
- `activeModelType`, `trainModelOnStartup` stored in monolith
- matching-scoring-service reads via `/internal/matching-scoring` proxy

**Migration Path:**
1. Add config table to matching-scoring-service
2. Read config from service's own DB instead of monolith
3. Remove from monolith endpoint

---

### Phase D Item 6: Resume File Storage
**Complexity:** MEDIUM | **Impact:** Medium | **Est. Time:** 2 hours

**Current State:**
- Files stored in monolith's `uploads/` directory
- resume-service proxies to monolith for file serving

**Migration Path:**
1. Create volume mount for resume-service
2. Copy existing files to resume-service volume
3. Update resume-service to serve locally
4. Remove from monolith

---

### Phase D Item 7: Chat RAG Corpus
**Complexity:** MEDIUM | **Impact:** Low | **Est. Time:** 1-2 hours

**Current State:**
- chat-service reads candidates/jobs from monolith via getAllCandidatesUnscoped
- Uses for RAG embeddings

**Migration Path:**
1. Update chat-service to call candidate-core-service and job-service APIs
2. Scope reads by company (add company_id to queries)
3. Remove monolith reads

---

### Phase D Item 8: RAG Indexing
**Complexity:** MEDIUM | **Impact:** High | **Est. Time:** 2-3 hours

**Current State:**
- rag.service.ts in monolith indexes on create
- Called from job-service and candidate-core-service via reverse-mirror

**Migration Path:**
1. Copy indexing logic to job-service
2. Copy indexing logic to candidate-core-service
3. Services index on their own write
4. Remove from monolith's mirror-and-notify handlers
5. Keep mirror for candidate/job data consistency

---

## Recommended Completion Order

**By Complexity (Easiest First):**
1. ✓ Item 5: ML Admin State (1 hour)
2. ✓ Item 6: Resume Storage (2 hours)
3. ✓ Item 4: Reasoning Conclusions (1-2 hours)
4. ✓ Item 7: Chat RAG Corpus (1-2 hours)
5. ✓ Item 8: RAG Indexing (2-3 hours)
6. ✓ Item 3: Career Trajectory (2-3 hours) [Saved for last—highest complexity]

**Total Estimated Time:** 9-13 hours

---

## Phase E: Endpoint Cleanup

Once Phase D items 3-4 are complete:
- Remove `/internal/matching-decision/career-trajectory` endpoint
- Remove `/internal/matching-decision/reasoning-conclusions` endpoint
- Remove `/internal/matching-scoring/*` endpoints (if all cutover)
- Remove unused internal endpoints

---

## Phase F: Monolith Decommission

1. Verify no services call monolith `/internal/*` endpoints
2. Run full integration tests
3. Document monolith's remaining role (if any)
4. Plan cutover to microservices-only

---

## Key Architectural Decisions Made

1. **Stateless Monolith**: Frontend + SSE removed; API-only in production
2. **Database Strategy**: Each service owns its data; monolith remains data gateway for read-heavy queries
3. **Event Backbone**: Redis pub/sub for all real-time communication
4. **Scaling Model**: Services scale independently; monolith can run N instances behind LB

---

## Next Session Checklist

- [ ] Item 5: ML Admin State (easiest win)
- [ ] Item 6: Resume File Storage
- [ ] Item 4: Reasoning Conclusions
- [ ] Item 7: Chat RAG Corpus  
- [ ] Item 8: RAG Indexing
- [ ] Item 3: Career Trajectory (if time)
- [ ] Phase E: Remove /internal/* endpoints
- [ ] Final integration tests + commit

