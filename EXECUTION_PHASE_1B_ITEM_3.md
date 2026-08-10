# Execution: Item 3 - GET /api/recruiter-review/:candidateId/:jobId (detail)

**Date**: 2026-08-07  
**Status**: DESIGN COMPLETE, READY FOR IMPLEMENTATION  
**Scope**: Migrate recruiter review detail from monolith proxy to matching-decision-service orchestration  
**Timeline**: 2 days (8 hours pair work, parallel with Item 1)  
**Dependency**: None (orchestration endpoints already exist)  

---

## Architecture

### Current State
- **Endpoint**: GET /api/recruiter-review/:candidateId/:jobId
- **Location**: Proxies to monolith's `getRecruiterReviewDetailWithExplanation`
- **Operations**:
  1. Fetch swipe + recruiter notes (local)
  2. Hydrate candidate details (candidate-core-service)
  3. Hydrate job details (job-service)
  4. Fetch explainability data (monolith: career_trajectories, reasoning_conclusions)
  5. Compute match explanation (pure code)

### Target State
- **Handler**: matching-decision-service's GET /api/recruiter-review/:candidateId/:jobId
- **Calls**:
  1. Local: Fetch swipe + notes from matching-decision-service DB
  2. Cross: `candidateCoreServiceClient.getCandidatesByIds([candidateId])`
  3. Cross: `jobServiceClient.getJobsByIds([jobId])`
  4. Cross: `identityServiceClient.getUsersByIds([recruiterId])`
  5. Cross: `monolithClient.getCareerTrajectory(candidateId)` (explainability)
  6. Cross: `monolithClient.getReasoningConclusions(candidateId)` (explainability)
  7. Compute: Match explanation (pure code - ported from monolith)

---

## Implementation Checklist

### Step 1: Explainability Code Port (2 hours)

#### Port from monolith: src/matching/explainability/
Create these pure functions (test against monolith's existing fixtures):

- [ ] `computeMatchExplanation.ts` (main orchestration)
- [ ] `narrativeGeneration.ts` (score narrative)
- [ ] `concernDetection.ts` (risk/concern detection)
- [ ] `skillProficiency.ts` (skill match analysis - subset only)
- [ ] `careerIntelligence/jobSequence.ts` (seniority inference)

**Key**: These are 100% pure functions, no database reads except the 2 monolith calls

### Step 2: Service Clients (2 hours)

#### matching-decision-service/src/services/candidateCoreServiceClient.ts
- [ ] Export `getCandidatesByIds(candidateIds: number[]): Promise<Candidate[]>`
- [ ] Call: `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/by-ids?ids=`

#### matching-decision-service/src/services/jobServiceClient.ts
- [ ] Export `getJobsByIds(jobIds: number[]): Promise<Job[]>`
- [ ] Call: `${JOB_SERVICE_URL}/internal/jobs/by-ids?ids=`

#### matching-decision-service/src/services/identityServiceClient.ts (NEW)
- [ ] Create new file
- [ ] Export `getUsersByIds(userIds: number[]): Promise<User[]>`
- [ ] Call: `${IDENTITY_SERVICE_URL}/internal/users/by-ids?ids=`

#### matching-decision-service/src/services/monolithExplainabilityClient.ts (NEW)
- [ ] Create new file
- [ ] Export `getCareerTrajectory(candidateId: number): Promise<TrajectoryData>`
- [ ] Call: `${MONOLITH_INTERNAL_URL}/internal/career-trajectory?candidateId=`
- [ ] Export `getReasoningConclusions(candidateId: number): Promise<ReasoningData>`
- [ ] Call: `${MONOLITH_INTERNAL_URL}/internal/reasoning-conclusions?subjectType=candidate&subjectId=`

### Step 3: Monolith New Endpoints (1 hour)

#### monolith: src/api/matching-decision-internal.routes.ts (NEW FILE)
These are READ-ONLY, thin pass-throughs of existing functions:

```typescript
// GET /internal/career-trajectory?candidateId=:candidateId
// Returns candidate's career trajectory data (for explainability)
router.get('/career-trajectory', async (req, res) => {
  const candidateId = Number(req.query.candidateId);
  if (!Number.isFinite(candidateId)) {
    return res.status(400).json({ error: 'candidateId required' });
  }
  const data = await db.getCareerTrajectory(candidateId);
  res.json(data || {});
});

// GET /internal/reasoning-conclusions?subjectType=candidate&subjectId=:subjectId
// Returns reasoning conclusions (for explainability)
router.get('/reasoning-conclusions', async (req, res) => {
  const subjectType = req.query.subjectType as string;
  const subjectId = Number(req.query.subjectId);
  if (subjectType !== 'candidate' || !Number.isFinite(subjectId)) {
    return res.status(400).json({ error: 'subjectType=candidate and subjectId required' });
  }
  const data = await db.getReasoningConclusions(subjectType, subjectId);
  res.json(data || {});
});
```

Register in server.ts:
```typescript
app.use('/internal', internalRoutes);
```

### Step 4: Handler Implementation (2 hours)

#### matching-decision-service/src/routes/recruiterReviewDetail.routes.ts
```typescript
router.get('/recruiter-review/:candidateId/:jobId', requireAuth, async (req, res) => {
  const candidateId = Number(req.params.candidateId);
  const jobId = Number(req.params.jobId);
  const companyId = req.user!.company_id;
  
  if (!Number.isFinite(candidateId) || !Number.isFinite(jobId)) {
    return res.status(400).json({ error: 'Invalid IDs' });
  }
  
  try {
    // 1. Fetch swipe + notes locally
    const swipe = await db.getSwipe(candidateId, jobId, companyId);
    if (!swipe) {
      return res.status(404).json({ error: 'Swipe not found' });
    }
    
    const notes = await db.getRecruiterNotes(candidateId, jobId, companyId);
    
    // 2-6. Parallel hydration + explainability
    const [candidate, job, recruiter, trajectory, reasoning] = await Promise.all([
      getCandidatesByIds([candidateId]).then(cs => cs[0]),
      getJobsByIds([jobId]).then(js => js[0]),
      getUsersByIds([swipe.recruiter_id]).then(us => us[0]),
      getCareerTrajectory(candidateId),
      getReasoningConclusions(candidateId),
    ]);
    
    // 7. Compute explanation
    const explanation = computeMatchExplanation({
      swipe,
      candidate,
      job,
      trajectory,
      reasoning,
    });
    
    // Build response
    const response = {
      id: swipe.id,
      candidate: {
        id: candidate.id,
        name: `${candidate.first_name} ${candidate.last_name}`,
        email: candidate.email,
        skills: candidate.skills,
      },
      job: {
        id: job.id,
        title: job.title,
        location: job.location,
      },
      recruiter: {
        id: recruiter?.id,
        name: recruiter?.name,
      },
      swipe: {
        action: swipe.action,
        match_score: swipe.match_score,
        decision_date: swipe.created_at,
      },
      notes: notes.map(n => ({ text: n.text, created_at: n.created_at })),
      explanation: explanation,
    };
    
    res.json(response);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get recruiter review detail');
    res.status(502).json({ error: 'Recruiter review data unavailable' });
  }
});
```

### Step 5: Environment Variables

#### matching-decision-service/src/config/env.ts
- [ ] Export `CANDIDATE_CORE_SERVICE_URL`
- [ ] Export `JOB_SERVICE_URL`
- [ ] Export `IDENTITY_SERVICE_URL`
- [ ] Export `MONOLITH_INTERNAL_URL` (already exists)

### Step 6: Tests (2 hours)

#### tests/routes/recruiterReviewDetail.test.ts
- [ ] Mock all service clients
- [ ] Mock explainability functions
- [ ] Test: Valid swipe → response with explanation
- [ ] Test: Missing swipe → 404
- [ ] Test: Service timeout → graceful degradation
- [ ] Test: Explanation computed correctly
- [ ] Test: Field types match monolith response

#### tests/parity/recruiter-review-detail-parity.test.ts
- [ ] 10 random candidate/job pairs
- [ ] Call monolith endpoint (flag OFF)
- [ ] Call service endpoint (flag ON)
- [ ] Deep-equal JSON comparison
- [ ] Verify explanation accuracy
- [ ] Verify field counts match

### Step 7: Feature Flag

#### matching-decision-service/src/config/env.ts
- [ ] Export `RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED`

#### Handler (conditional)
```typescript
if (RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED) {
  return orchestrated response;
} else {
  return monolith proxy response;
}
```

---

## Response Shape (A/B Parity Target)

### Endpoint
```
GET /api/recruiter-review/:candidateId/:jobId
```

### Response (200 OK)
```json
{
  "id": 1,
  "candidate": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "skills": ["JavaScript", "React"]
  },
  "job": {
    "id": 101,
    "title": "Senior Engineer",
    "location": "San Francisco"
  },
  "recruiter": {
    "id": 5,
    "name": "Jane Smith"
  },
  "swipe": {
    "action": 1,
    "match_score": 0.87,
    "decision_date": "2026-08-05T10:00:00Z"
  },
  "notes": [
    {
      "text": "Strong technical background",
      "created_at": "2026-08-05T10:30:00Z"
    }
  ],
  "explanation": {
    "overall_narrative": "...",
    "score_breakdown": { ... },
    "concerns": [...],
    "strengths": [...],
    "seniority_alignment": "..."
  }
}
```

### Error Response
```json
{
  "error": "Recruiter review data unavailable"
}
```

---

## Explainability Functions (Pure Code - No DB)

### Input
```typescript
{
  swipe: { id, action, match_score, recruiter_id, ... },
  candidate: { id, name, skills, experience_years, ... },
  job: { id, title, required_skills, salary, ... },
  trajectory: { seniority_level, years_in_current_role, ... },
  reasoning: { concern_flags, strength_flags, ... }
}
```

### Output (explanation object)
```typescript
{
  overall_narrative: string,
  score_breakdown: { technical: number, experience: number, ... },
  concerns: string[],
  strengths: string[],
  seniority_alignment: string
}
```

**All computed from inputs above, zero database reads**

---

## Dependencies & Integration

### Requires (must exist)
- ✅ candidate-core-service: `GET /internal/candidates/by-ids`
- ✅ job-service: `GET /internal/jobs/by-ids`
- ✅ identity-service: `GET /internal/users/by-ids` (NEW - must create)
- ✅ monolith: Two new read-only internal endpoints (NEW - must create)

### Used By
- Item 5: CQRS hooks may need detail data for recruiter_review_view

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| P50 Latency | < 200ms | 6 parallel calls (2 monolith) |
| P95 Latency | < 500ms | |
| P99 Latency | < 1000ms | Timeout at 5s on each |
| Error Rate | < 0.01% | Graceful degradation |

---

## Done Criteria

- [ ] Explainability code ported + unit tested
- [ ] All service clients implemented + working
- [ ] Monolith new endpoints added (read-only)
- [ ] Handler orchestrates 6 calls + computes explanation
- [ ] Feature flag works (ON/OFF)
- [ ] Unit tests passing (100% coverage)
- [ ] Integration tests passing (real services)
- [ ] A/B parity 100% (10 pairs verified)
- [ ] Staging sign-off
- [ ] Ready for production canary

---

## Time Breakdown

| Task | Hours | Parallel |
|------|-------|----------|
| Explainability port | 2 | Pair 1 |
| Service clients | 2 | Pair 1 |
| Monolith endpoints | 1 | Pair 1 |
| Handler + config | 1 | Pair 1 |
| Tests | 2 | Pair 1 |
| **Total** | **8 hours** | **Parallel with Item 1** |

---

## Identity Service New Endpoint

### identity-service: src/routes/internal.routes.ts (ADD)

```typescript
router.get('/users/by-ids', async (req, res) => {
  const idsParam = req.query.ids as string;
  if (!idsParam) {
    return res.json({ users: [] });
  }
  
  const ids = idsParam
    .split(',')
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n));
  
  if (ids.length === 0) {
    return res.json({ users: [] });
  }
  
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  const result = await db.query(
    `SELECT id, name, email FROM users WHERE id IN (${placeholders})`,
    ids
  );
  
  res.json({ users: result.rows });
});
```

---

**Prepared by**: Migration Team  
**Status**: READY FOR EXECUTION  
**Estimated Start**: Aug 7 (parallel with Item 1)  
**Expected Completion**: Aug 9  
**Confidence**: HIGH  
