# Phase 1 Implementation Guide - Detailed Technical Path

**Document Version**: 1.0  
**Last Updated**: 2026-08-06  
**Target Completion**: Week 5 (32 hours remaining)  

---

## QUICK REFERENCE: COMPLETED IMPLEMENTATIONS

### Step 1: Job Detail (✅ Complete - ready for staging)
```typescript
// Pattern: Local query → cross-service clients → feature flag
GET /api/jobs/:id
├─ Query: jobs table (job-service local)
├─ Call 1: candidate-core-service/internal/candidates/for-job-scoring (5s timeout)
├─ Call 2: matching-scoring-service/internal/rank-candidates-for-job (5s timeout)
└─ Feature Flag: JOB_DETAIL_CUTOVER_ENABLED (default: false)
```

### Step 3: Resume Detail (✅ Complete - ready for staging)
```typescript
// Pattern: Pure local query (zero cross-service calls)
GET /api/candidates/:id/resume
├─ Query: candidates table resume fields (candidate-core-service local)
└─ Feature Flag: CANDIDATE_RESUME_CUTOVER_ENABLED (default: false)
```

---

## IMPLEMENTATION TEMPLATE FOR REMAINING STEPS

Every Phase 1 endpoint follows this exact pattern:

```typescript
// Step Template: [N] [Endpoint Name]

1. IDENTIFY DATA SOURCES
   ├─ Monolith query: [SQL query from src/db.ts]
   ├─ Tables involved: [list tables]
   └─ Service ownership: [which Tier 0 service owns each table]

2. CREATE SERVICE CLIENTS (in target service)
   ├─ File: src/services/[dependencyService]Client.ts
   └─ Methods: [getCandidates(), getJobs(), etc.]

3. IMPLEMENT LOCAL HANDLER (in target service)
   ├─ File: src/routes/[endpoint]/[handler].ts
   ├─ Pattern: Local query → service clients → merge → return
   └─ Typing: Interface with exact monolith field names

4. ADD FEATURE FLAG (in target service)
   ├─ env.ts: export const [ENDPOINT]_CUTOVER_ENABLED
   ├─ .env.local: [ENDPOINT]_CUTOVER_ENABLED=false
   └─ Handler: check flag → false = 404, true = full implementation

5. WIRE ROUTE (in target service)
   ├─ routes/index.ts: import handler + feature flag
   └─ GET route: parse params → feature flag check → handler → response

6. DOCUMENT (create STEP_N_[ENDPOINT]_MIGRATION.md)
   ├─ Architecture diagram
   ├─ Testing checklist
   ├─ Rollout phases
   └─ Verification commands
```

---

## STEP-BY-STEP IMPLEMENTATION ROADMAP

### Step 5: GET /api/recruiter-matches (Matched Candidates)
**Service**: recruiting-service  
**Status**: Currently proxies to monolith  
**Complexity**: MEDIUM (4-table join, 3 cross-service calls)  
**Effort**: 4-5 hours  

#### Data Source Analysis
```
Monolith Query (db.ts:2775):
  FROM mutual_matches mm
  JOIN jobs j ON j.id = mm.job_id
  LEFT JOIN candidates cand ON cand.id = mm.candidates_id
  LEFT JOIN recruiter_notifications rn ON rn.match_id = mm.id

Table Ownership:
  ✅ mutual_matches → candidate-service (mirrored in 004_analytics_mirror.up.sql)
  ✅ jobs → job-service
  ✅ candidates → candidate-core-service (or candidates from monolith)
  ✅ recruiter_notifications → recruiting-service (local)
```

#### Implementation Steps
1. **Create candidate-service internal endpoint**:
   ```typescript
   // GET /internal/matches/by-company?companyId=123&jobId=456
   // Returns: { matches: [{ id, candidate_id, job_id, matched_at }] }
   ```

2. **Create service clients in recruiting-service**:
   ```typescript
   - candidateServiceClient.ts (get matches by company)
   - jobServiceClient.ts (get jobs by ids)
   - candidateCoreServiceClient.ts (get candidates by ids)
   ```

3. **Implement orchestration in recruiting-service**:
   ```typescript
   async function getRecruiterMatches(companyId, jobId, userId) {
     // 1. Get matches from candidate-service
     const matches = await getMatchesByCompany(companyId, jobId);
     
     // 2. Get job details in parallel
     const jobIds = [...new Set(matches.map(m => m.job_id))];
     const jobs = await getJobsByIds(jobIds);
     
     // 3. Get candidate details in parallel
     const candidateIds = [...new Set(matches.map(m => m.candidate_id))];
     const candidates = await getCandidatesByIds(candidateIds);
     
     // 4. Get notifications for this user
     const notifications = await getNotificationsForUser(userId, companyId);
     
     // 5. Merge: match + job + candidate + notification
     return matches.map(m => ({
       id: m.id,
       job_id: m.job_id,
       matched_at: m.matched_at,
       job_title: jobs.find(j => j.id === m.job_id)?.title,
       candidate_id: m.candidate_id,
       candidate_name: candidates.find(c => c.id === m.candidate_id)?.name,
       ...
       notification_id: notifications.find(n => n.match_id === m.id)?.id,
       read_at: notifications.find(n => n.match_id === m.id)?.read_at
     }));
   }
   ```

4. **Wiring**:
   ```typescript
   // recruiting-service/src/routes/matches.routes.ts
   
   router.get('/matches', async (req, res) => {
     if (!RECRUITER_MATCHES_CUTOVER_ENABLED) {
       // Fall back to monolith proxy
       return proxyToMonolith(req, res);
     }
     
     const matches = await getRecruiterMatches(
       req.user.company_id,
       req.query.job_id,
       req.user.user_id
     );
     res.json({ matches });
   });
   ```

---

### Step 6: GET /api/chat/:threadId (Chat Messages)
**Service**: chat-service  
**Status**: Unknown (needs investigation)  
**Effort**: 3-4 hours  

#### Investigation Needed
1. Check if chat-service exists and owns threads/messages
2. Identify any cross-service dependencies (candidate/job enrichment)
3. Determine if feature flag needed or direct implementation

---

### Step 7-10: Skill/Role/Career/Proficiency Intelligence Endpoints
**Services**: Multiple specialized services  
**Status**: Likely shadow-mode or not yet migrated  
**Effort**: 12-16 hours total  

#### Pattern
All these endpoints likely follow ML/analytics pattern:
- Read specialized service's own local data
- Minimal cross-service calls
- Mostly pure computation on local DB

---

### Step 11-15: Remaining Read Endpoints

**GET /api/candidate-decisions**
- Service: candidate-service
- Data: Local candidate_decisions table
- Effort: 2 hours

**GET /api/candidate-applications**
- Service: candidate-service
- Data: Local candidate_application_status table
- Effort: 2 hours

**GET /api/chat/threads**
- Service: chat-service
- Data: Local threads table
- Effort: 2 hours

**GET /api/analytics/dashboard**
- Service: analytics-service
- Data: Aggregated from multiple services
- Effort: 3-4 hours

**GET /api/ml/model-metrics**
- Service: matching-scoring-service
- Data: Local model metrics
- Effort: 2 hours

---

## FEATURE FLAG STRATEGY

All steps use consistent feature flag pattern:

```typescript
// 1. Define in env.ts
export const [STEP]_CUTOVER_ENABLED = process.env.[STEP]_CUTOVER_ENABLED === 'true';

// 2. Set in .env.local
[STEP]_CUTOVER_ENABLED=false

// 3. Use in handler
router.get('/endpoint', async (req, res) => {
  if (![STEP]_CUTOVER_ENABLED) {
    // Fallback behavior (404, proxy to monolith, etc.)
  }
  // Real implementation
});

// 4. Canary rollout
// Week 2: Enable for 10% of requests
// Week 3: Enable for 50% of requests
// Week 4: Enable for 100% of requests
```

---

## CROSS-SERVICE CLIENT PATTERN

Every service needs consistent client implementation:

```typescript
// src/services/[serviceType]Client.ts

import { logger } from '../utils/logger.js';

const [SERVICE]_URL = process.env.[SERVICE]_URL || 'http://localhost:PORT';
const REQUEST_TIMEOUT = 5000; // 5 seconds

export async function [getFunction](params): Promise<ReturnType> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `${[SERVICE]_URL}/internal/[endpoint]?...`,
      {
        method: 'GET|POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(...),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        '[Service] error'
      );
      return fallbackValue; // Never throw
    }

    return await response.json();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn({}, '[Service] timeout');
    } else {
      logger.warn({ err: error.message }, '[Service] error');
    }
    return fallbackValue; // Never throw - fire-and-forget
  }
}
```

---

## TESTING TEMPLATE FOR EACH STEP

```typescript
// tests/[step].test.ts

describe('[Step N: Endpoint Name]', () => {
  
  // Unit tests
  test('local handler with valid input', async () => {
    const result = await handler(validInput);
    expect(result).toEqual(expectedOutput);
  });

  test('local handler with invalid ID (404)', async () => {
    const result = await handler({ id: 999 });
    expect(result).toBeNull();
  });

  // Integration tests
  test('full request with feature flag ON', async () => {
    process.env.[STEP]_CUTOVER_ENABLED = 'true';
    const response = await request(app).get('/api/endpoint');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('data');
  });

  test('full request with feature flag OFF', async () => {
    process.env.[STEP]_CUTOVER_ENABLED = 'false';
    const response = await request(app).get('/api/endpoint');
    expect(response.status).toBe(404);
  });

  // A/B parity tests
  test('monolith response == service response', async () => {
    const monolith = await getFromMonolith(testData);
    const service = await getFromService(testData);
    expect(deepEqual(monolith, service)).toBe(true);
  });
});
```

---

## DEPLOYMENT CHECKLIST FOR EACH STEP

- [ ] Implementation complete (handler, clients, feature flag)
- [ ] Unit tests passing (100% coverage on new code)
- [ ] Integration tests passing (full request flow)
- [ ] A/B parity tests passing (monolith == service)
- [ ] Code review approved
- [ ] Documentation complete (STEP_N_*.md)
- [ ] Staging deployment successful
- [ ] Performance tests passing (P99 < 500ms)
- [ ] Canary 10% deployment (monitor 48 hours)
- [ ] Beta 50% deployment (monitor 7 days)
- [ ] GA 100% deployment
- [ ] Rollback procedure tested

---

## EFFORT ESTIMATE BREAKDOWN

| Step | Endpoint | Effort | Status |
|------|----------|--------|--------|
| 1 | Job Detail | 6h | ✅ Complete |
| 2 | Candidate Profile | 0h | ✅ Already done |
| 3 | Resume Detail | 2h | ✅ Complete |
| 4 | Candidate Search | 0h | ✅ Already done |
| 5 | Recruiter Matches | 5h | 🔄 Next |
| 6 | Chat Messages | 4h | 📋 Planned |
| 7 | Skill Intelligence | 3h | 📋 Planned |
| 8 | Role Intelligence | 3h | 📋 Planned |
| 9 | Career Intelligence | 3h | 📋 Planned |
| 10 | Proficiency Analytics | 2h | 📋 Planned |
| 11-15 | Remaining endpoints | 8h | 📋 Planned |
| **Total** | **Phase 1** | **39h** | |

---

## CURRENT STATUS

**Completed**: 8 hours (Steps 1, 2, 3)  
**Remaining**: 31 hours  
**Velocity**: 4-5 hours per endpoint  
**Target Completion**: By end of Week 5  

---

## NEXT IMMEDIATE ACTIONS

1. **Implement Step 5** (2-3 hours)
   - Create candidate-service internal endpoint for mutual_matches
   - Create service clients in recruiting-service
   - Implement orchestration handler
   - Add feature flag + documentation

2. **Testing** (1 hour)
   - Unit tests for orchestration
   - Integration tests for full request
   - A/B parity test vs monolith

3. **Documentation** (30 minutes)
   - STEP_5_RECRUITER_MATCHES_MIGRATION.md
   - Update PHASE_1_MIGRATION_STATUS.md

---

## QUALITY GATES

Every step must pass before proceeding:
1. All tests passing
2. Feature flag working correctly
3. Monolith fallback verified
4. Documentation complete
5. Code review approved
6. Staging deployment successful

If any step fails: rollback and investigate root cause.

---

**Prepared by**: Claude Code  
**For**: Tejoma Monolith-to-Microservices Migration  
**Authorization**: User requested continuous implementation
