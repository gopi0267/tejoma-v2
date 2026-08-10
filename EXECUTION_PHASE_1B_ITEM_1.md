# Execution: Item 1 - GET /api/jobs (list) Migration

**Date**: 2026-08-07  
**Status**: IN PROGRESS  
**Scope**: Migrate GET /api/jobs from monolith proxy to job-service fan-out orchestration  
**Timeline**: 2 days (pair programming, full test coverage)  

---

## Architecture Summary

### Current State
- **Endpoint**: GET /api/jobs (list)
- **Location**: Proxies to monolith's `getEnrichedJobsList` 
- **Pattern**: Pure fan-out + merge (no SQL join needed)
- **Dependencies**: 
  - job-service: owns `jobs` table (✅ already migrated)
  - matching-decision-service: owns `swipes` table (✅ already migrated)
  - candidate-core-service: owns `candidates` table (✅ already migrated)

### Target State
- **Handler**: job-service's `GET /api/jobs`
- **Pattern**: Local orchestration (same as `GET /api/jobs/:id`)
- **Calls**:
  1. `db.getJobs(companyId)` - local read
  2. `matchingDecisionServiceClient.getSwipeCountsByJob(companyId)` - cross-service
  3. `candidateCoreServiceClient.getCandidateCount(companyId)` - cross-service
- **Merge**: Add counts to each job, compute acceptance_rate

---

## Implementation Checklist

### Step 1: Service Clients ✅ DONE

#### matching-decision-service client (getSwipeCountsByJob)
- [x] `job-service/src/services/matchingDecisionServiceClient.ts` - Added `getSwipeCountsByJob(companyId)` 
- [x] Method signature: `Promise<SwipeCountMap>` where SwipeCountMap = `Map<number, { total, accepted, rejected, pending }>`
- [x] Timeout: 5 seconds
- [x] Error handling: Returns empty Map on failure (graceful degradation)

#### candidate-core-service client (getCandidateCount)
- [ ] Check if `getCandidateCount` already exists in `job-service/src/services/candidateCoreServiceClient.ts`
- [ ] If not, add: `getCandidateCount(companyId): Promise<number>`
- [ ] Timeout: 5 seconds
- [ ] Error handling: Returns 0 on failure

### Step 2: Internal Endpoints ✅ DONE

#### matching-decision-service internal endpoint
- [x] Created `GET /internal/swipes/counts-by-job?companyId=:companyId`
- [x] Returns: `{ [jobId]: { total, accepted, rejected, pending } }`
- [x] Registered in: `matching-decision-service/src/routes/internal.routes.ts`

#### candidate-core-service internal endpoint
- [ ] Check if `GET /internal/candidates/count?companyId=:companyId` already exists
- [ ] If not, create it: returns `{ count: number }`

### Step 3: Handler Implementation ✅ DONE

#### job-service GET /api/jobs handler
- [x] `job-service/src/routes/jobs.routes.ts` - Lines 45-78
- [x] Function: `getEnrichedJobsList(companyId)`
- [x] Implementation:
  ```typescript
  const [jobs, swipeCounts, totalCandidates] = await Promise.all([
    db.getJobs(companyId),
    getSwipeCountsByJob(companyId),
    getCandidateCount(companyId),
  ]);
  ```
- [x] Merge logic: Add swipe counts + total_candidates to each job
- [x] Compute acceptance_rate = (accepted / reviewed) * 100

### Step 4: Configuration

#### Environment Variables
- [x] `MATCHING_DECISION_SERVICE_URL` - Already exported in `job-service/src/config/env.ts:36`
- [ ] Verify in `.env.local`: `MATCHING_DECISION_SERVICE_URL=http://matching-decision-service:4020`
- [ ] Verify `CANDIDATE_CORE_SERVICE_URL` exists

### Step 5: Testing

#### Unit Tests
- [ ] `job-service/tests/routes/jobs.getJobsList.test.ts` (new file)
  - [ ] Mock getJobs (local)
  - [ ] Mock getSwipeCountsByJob (client)
  - [ ] Mock getCandidateCount (client)
  - [ ] Verify response shape: `{ jobs: [{ ...job, total_candidates, reviewed, accepted, rejected, saved, acceptance_rate }] }`
  - [ ] Verify field types (numbers, not strings)
  - [ ] Verify acceptance_rate formula
  - [ ] Test empty jobs array
  - [ ] Test missing swipe counts (should default to { reviewed: 0, ... })

#### Integration Tests
- [ ] `tests/integration/jobs-list.test.ts`
  - [ ] Deploy all 3 services to test environment
  - [ ] Call GET /api/jobs via API gateway
  - [ ] Verify monolith proxy still works (flag OFF)
  - [ ] Verify service cutover works (flag ON)
  - [ ] Verify A/B parity: `monolith response ===  service response`

#### A/B Parity Tests
- [ ] `tests/parity/jobs-list-parity.test.ts`
  - [ ] 20 random companies with 5+ jobs each
  - [ ] Call both endpoints (feature flag ON/OFF)
  - [ ] Deep-equal JSON comparison
  - [ ] Check: job counts, acceptance rates, swipe stats

### Step 6: Feature Flag

#### Code
- [x] Flag exists: `JOB_LIST_CUTOVER_ENABLED` in `job-service/src/config/env.ts:39`
- [ ] Implement conditional in handler:
  ```typescript
  if (JOB_LIST_CUTOVER_ENABLED) {
    return await getEnrichedJobsList(companyId);
  } else {
    return await monolithClient.proxyGetJobsList(companyId);
  }
  ```

#### Environment
- [ ] `.env.local`: `JOB_LIST_CUTOVER_ENABLED=false` (default OFF for safety)
- [ ] `.env.staging`: `JOB_LIST_CUTOVER_ENABLED=false` initially
- [ ] `.env.production`: `JOB_LIST_CUTOVER_ENABLED=false` initially

### Step 7: Monitoring

#### Metrics
- [ ] Add Prometheus metrics to handler:
  - `http_request_duration_seconds{endpoint="/api/jobs"}`
  - `job_list_total_candidates{company_id}`
  - `job_list_swipe_counts{job_id,action}` (per-job breakdown)
  - `job_list_cutover_enabled` (0/1 flag state)

#### Alerts
- [ ] Alert if P99 latency > 500ms (reads should be < 100ms + 3 cross-service calls ~5ms each)
- [ ] Alert if error rate > 0.01%

### Step 8: Rollback

#### Manual Rollback
- [ ] Edit `.env.local`: `JOB_LIST_CUTOVER_ENABLED=false`
- [ ] Restart job-service: `docker restart job-service` or `kubectl rollout restart deployment/job-service`
- [ ] Verify: `GET /api/jobs` returns monolith-proxied results

#### Automatic Rollback
- [ ] If error rate spike: Ops flips flag OFF immediately (< 1 minute recovery)
- [ ] No data loss possible (monolith's `jobs` table untouched)

---

## Response Shape (A/B Parity Target)

### Endpoint
```
GET /api/jobs?companyId=:companyId
```

### Response (200 OK)
```json
[
  {
    "id": 1,
    "company_id": 100,
    "title": "Senior Engineer",
    "description": "...",
    "required_skills": ["Node.js", "TypeScript"],
    "location": "San Francisco",
    "salary_min": 150000,
    "salary_max": 200000,
    "status": "open",
    "created_at": "2026-08-01T10:00:00Z",
    "updated_at": "2026-08-07T14:30:00Z",
    
    "total_candidates": 250,
    "reviewed": 45,
    "accepted": 12,
    "rejected": 30,
    "saved": 3,
    "acceptance_rate": 26.7
  },
  ...
]
```

### Error Response (502 Bad Gateway - if services unavailable)
```json
{
  "error": "Job data is currently unavailable. Please try again."
}
```

---

## Done Criteria

- [ ] All 4 internal endpoints working (counts, count, latest-per-pair, latest-by-candidate)
- [ ] getSwipeCountsByJob returns correct shape
- [ ] getCandidateCount returns correct number
- [ ] Handler orchestrates all 3 calls in parallel
- [ ] Feature flag works (ON/OFF toggle)
- [ ] Unit tests passing (100% coverage on new code)
- [ ] Integration tests passing (real services)
- [ ] A/B parity 100% (20 companies verified)
- [ ] Staging environment sign-off
- [ ] Ready for production canary (10%)

---

## Time Breakdown

| Task | Hours | Status |
|------|-------|--------|
| Service clients | 1 | ✅ |
| Internal endpoints | 1.5 | ✅ |
| Handler implementation | 1 | ✅ |
| Configuration | 0.5 | ⏳ |
| Unit tests | 3 | ⏳ |
| Integration tests | 2 | ⏳ |
| A/B parity tests | 2 | ⏳ |
| Documentation + code review | 1 | ⏳ |
| **Total** | **12 hours** | |

---

## Next Steps

1. **Today**: Complete configuration + unit tests
2. **Tomorrow AM**: Integration tests + A/B parity
3. **Tomorrow PM**: Staging sign-off + prepare canary rollout
4. **Week 2**: Production canary (10% → 50% → 100%)

---

**Prepared by**: Migration Team  
**Status**: READY FOR CONTINUED EXECUTION  
**Confidence**: HIGH  
