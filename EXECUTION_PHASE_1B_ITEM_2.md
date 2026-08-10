# Execution: Item 2 - GET /api/candidate-search → tab/shortlisted

**Date**: 2026-08-07  
**Status**: DESIGN COMPLETE, READY FOR IMPLEMENTATION  
**Scope**: Migrate shortlisted candidates tab from monolith proxy to service orchestration  
**Timeline**: 1 day (6 hours pair work)  
**Dependency**: Item 1 (uses latest-per-pair endpoint which already exists)  

---

## Architecture

### Current State
- **Endpoint**: GET /api/candidate-search/shortlisted
- **Location**: Proxies to monolith's `getShortlistedCandidateAccounts`
- **Operation**: Filters swipes where action=1 (accepted) + hydrates candidate details
- **Pattern**: Pure filter + fan-out (no complex joins)

### Target State
- **Handler**: candidate-service's GET /api/candidate-search/shortlisted
- **Pattern**: Cross-service orchestration (matching-decision + candidate-core)
- **Calls**:
  1. `matchingDecisionServiceClient.getLatestSwipesPerPair(companyId, action=1)` - get accepted swipes
  2. Extract candidate IDs from swipes
  3. `candidateCoreServiceClient.getCandidatesByIds(candidateIds)` - hydrate candidate details
  4. Local `toSearchResultShape()` - transform to response format

---

## Implementation Checklist

### Step 1: Service Clients (1 hour)

#### candidate-service/src/services/matchingDecisionServiceClient.ts (NEW)
- [ ] Create new file
- [ ] Export `getLatestSwipesPerPair(companyId: number, action?: number): Promise<Swipe[]>`
- [ ] Call: `${MATCHING_DECISION_SERVICE_URL}/internal/swipes/latest-per-pair?companyId=&action=`
- [ ] Timeout: 5 seconds
- [ ] Error: Return empty array

#### candidate-service/src/services/candidateCoreServiceClient.ts (NEW)
- [ ] Create new file
- [ ] Export `getCandidatesByIds(candidateIds: number[]): Promise<Candidate[]>`
- [ ] Call: `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/by-ids?ids=`
- [ ] Timeout: 5 seconds
- [ ] Error: Return empty array

### Step 2: Environment Variables

#### candidate-service/src/config/env.ts
- [ ] Export `MATCHING_DECISION_SERVICE_URL` (add if missing)
- [ ] Export `CANDIDATE_CORE_SERVICE_URL` (add if missing)
- [ ] Add both to REQUIRED_ALWAYS list

### Step 3: Handler Implementation (2 hours)

#### candidate-service/src/routes/candidateSearch.routes.ts (NEW)
```typescript
router.get('/candidate-search/shortlisted', requireAuth, async (req, res) => {
  const companyId = req.user!.company_id;
  
  try {
    // 1. Get accepted swipes
    const swipes = await getLatestSwipesPerPair(companyId, 1);
    
    if (swipes.length === 0) {
      return res.json([]);
    }
    
    // 2. Extract candidate IDs
    const candidateIds = [...new Set(swipes.map(s => s.candidate_id))];
    
    // 3. Get candidate details
    const candidates = await getCandidatesByIds(candidateIds);
    
    // 4. Merge: candidate + swipe data
    const result = candidates.map(candidate => ({
      candidate_id: candidate.id,
      name: `${candidate.first_name} ${candidate.last_name}`,
      email: candidate.email,
      skills: candidate.skills || [],
      years_experience: candidate.experience_years,
      // Find all swipes for this candidate
      jobs: swipes
        .filter(s => s.candidate_id === candidate.id)
        .map(s => ({
          job_id: s.job_id,
          decision_date: s.created_at,
        })),
    }));
    
    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get shortlisted candidates');
    res.status(502).json({ error: 'Shortlisted candidates unavailable' });
  }
});
```

### Step 4: Tests (2 hours)

#### candidate-service/tests/routes/candidateSearch.shortlisted.test.ts (NEW)
- [ ] Mock getLatestSwipesPerPair
- [ ] Mock getCandidatesByIds
- [ ] Test: Empty swipes array → empty response
- [ ] Test: Swipes with candidates → response shaped correctly
- [ ] Test: Timeout handling → empty array returned (graceful)
- [ ] Test: Field types (numbers, strings, arrays)
- [ ] Test: No duplicate candidates
- [ ] Test: Jobs array per candidate correct

### Step 5: A/B Parity Testing (1 hour)

#### tests/parity/candidate-search-shortlisted-parity.test.ts (NEW)
- [ ] 10 random companies
- [ ] Call monolith endpoint (flag OFF)
- [ ] Call service endpoint (flag ON)
- [ ] Deep-equal JSON comparison
- [ ] Verify candidate count matches
- [ ] Verify skills array matches
- [ ] Verify jobs array matches

### Step 6: Feature Flag (Optional - can skip for this item)

Since Item 2 is a pure read operation and Item 1's dependencies are stable, we could:
- **Option A**: Add feature flag like Items 1, 3, 4, 5
- **Option B**: Direct cutover (no flag needed) since fallback is built-in

Recommendation: Add flag for consistency

#### candidate-service/src/config/env.ts
- [ ] Export `CANDIDATE_SEARCH_CUTOVER_ENABLED = process.env.CANDIDATE_SEARCH_CUTOVER_ENABLED === 'true'`

#### Handler
```typescript
if (CANDIDATE_SEARCH_CUTOVER_ENABLED) {
  return orchestrated response;
} else {
  return monolith proxy response;
}
```

---

## Response Shape (A/B Parity Target)

### Endpoint
```
GET /api/candidate-search/shortlisted?companyId=:companyId
```

### Response (200 OK)
```json
[
  {
    "candidate_id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "skills": ["JavaScript", "React", "Node.js"],
    "years_experience": 8,
    "jobs": [
      {
        "job_id": 101,
        "decision_date": "2026-08-05T10:00:00Z"
      },
      {
        "job_id": 102,
        "decision_date": "2026-08-04T14:30:00Z"
      }
    ]
  },
  ...
]
```

### Error Response
```json
{
  "error": "Shortlisted candidates unavailable"
}
```

---

## Dependencies & Integration

### Requires (must exist before this item)
- ✅ matching-decision-service: `GET /internal/swipes/latest-per-pair` (Item 1)
- ✅ candidate-core-service: `GET /internal/candidates/by-ids` (already exists)

### Used By (future items)
- Item 5: CQRS hooks use latest-per-pair endpoint (will be stable after this item tests it)

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| P50 Latency | < 100ms | 2 service calls in parallel |
| P95 Latency | < 200ms | |
| P99 Latency | < 500ms | Timeout at 5s on each call |
| Error Rate | < 0.01% | Graceful degradation if services slow |
| Throughput | 50 req/s | Tested sustained |

---

## Done Criteria

- [ ] Both service clients implemented + tested
- [ ] Handler orchestrates 2 calls in parallel
- [ ] Feature flag works (ON/OFF toggle)
- [ ] Unit tests passing (100% coverage)
- [ ] Integration tests passing (real services)
- [ ] A/B parity 100% (10 companies verified)
- [ ] Staging environment validation
- [ ] Ready for production canary

---

## Time Breakdown

| Task | Hours | Parallel |
|------|-------|----------|
| Service clients | 1 | Solo |
| Handler + config | 1.5 | Solo |
| Unit tests | 1 | Solo |
| Integration tests | 1 | Solo |
| A/B parity tests | 0.5 | Pair 1 |
| **Total** | **5 hours** | |

---

## Daily Sync Points

**Day 5 (Item 2 day)**:
- 9 AM: Kickoff (Pair 2 starts on this while Pair 1 wraps Item 1/3)
- 2 PM: Demo service clients
- 4 PM: Wrap + staging prep

**Day 6 (Canary prep)**:
- 9 AM: Item 2 + 3 production sign-off
- 2 PM: Canary rollout plan
- 4 PM: Team validation

---

**Prepared by**: Migration Team  
**Status**: READY FOR EXECUTION  
**Estimated Start**: Aug 10 (after Items 1 + 3 sign-off)  
**Expected Completion**: Aug 11  
