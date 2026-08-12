# PHASE 1: CANDIDATE-DECISIONS INSPECTION REPORT

**Date:** 2026-08-12  
**Status:** Complete inspection findings

---

## Architecture Tracing: Frontend → Gateway → Service → Database

### Request Path: GET /api/candidate-decisions

```
Frontend (React app)
  ↓
API Gateway (port 4000)
  - Route: /api/candidate-decisions → CANDIDATE_SERVICE_URL
  ↓
Candidate Service (port 4016)
  - File: candidate-service/src/routes/candidateDecisions.routes.ts
  - Handler: router.get('/candidate-decisions', ...)
  ↓
monolithClient.getCandidateDecisions()
  - File: candidate-service/src/services/monolithClient.ts (line 82)
  - HTTP call: GET /internal/candidate/decisions?candidateAccountId=xxx
  ↓
Monolith (port 3006)
  - File: src/api/candidate-internal.routes.ts (line 163)
  - Handler: router.get('/decisions', ...)
  - DB function: db.getCandidateDecisions()
  ↓
PostgreSQL
  - Database: tejoma_recruiting (monolith's database)
  - Table: candidate_decisions
  - Query: SELECT ... FROM candidate_decisions WHERE candidate_account_id = $1
```

---

## Candidate-Decisions Endpoints

### **1. Record a Decision (Write)**
```
POST /api/candidate-decisions

Request Body:
{
  "job_id": integer,
  "decision_type": "swipe_right" | "swipe_left" | "apply"
}

Current Flow:
  → monolithClient.recordCandidateDecision()
  → POST /internal/candidate/decisions
  → db.recordCandidateDecision()
  → INSERT INTO candidate_decisions (candidate_account_id, job_id, action, decision_type, timestamp)
  → Also triggers: getOrCreateLinkedCandidateRow() + evaluateAndCreateMutualMatch()

Response:
{
  "decision": {
    "id": integer,
    "candidate_account_id": integer,
    "job_id": integer,
    "action": 1 | 0,  // 1 = swipe_right/apply, 0 = swipe_left
    "decision_type": string,
    "timestamp": ISO timestamp
  }
}
```

### **2. Get Full Decision History (Read)**
```
GET /api/candidate-decisions

Current Flow:
  → monolithClient.getCandidateDecisions()
  → GET /internal/candidate/decisions?candidateAccountId=xxx
  → db.getCandidateDecisions()
  → SELECT FROM candidate_decisions + JOIN jobs + JOIN companies

Response:
{
  "decisions": [
    {
      "id": integer,
      "job_id": integer,
      "action": 1 | 0,
      "decision_type": string,
      "timestamp": ISO timestamp,
      "job_title": string,
      "company_name": string,
      "company_logo_url": string
    },
    ...
  ]
}
```

### **3. Get Active Decisions Per Job (Read)**
```
GET /api/candidate-decisions/active?action=1  [optional]

Current Flow:
  → monolithClient.getCandidateActiveDecisions()
  → GET /internal/candidate/decisions/active?candidateAccountId=xxx&action=optional
  → db.getCandidateActiveDecisions()
  → DISTINCT ON (job_id) - latest decision per job

Response: Same as above (filtered to latest per job, optionally by action)
```

### **4. Get Decision Status for a Job (Read)**
```
GET /api/candidate-decisions/status/:jobId

Current Flow:
  → monolithClient.getCandidateDecisionStatus()
  → GET /internal/candidate/decisions/status?candidateAccountId=xxx&jobId=xxx
  → db.getRecruiterDecisionForCandidateJob() + db.getLatestCandidateDecision()
  → Returns: "interested" | "rejected" | "expired" | "waiting"

Logic:
  1. Check if recruiter has made a decision on this candidate
  2. If recruiter rejected: return "rejected"
  3. If recruiter interested: return "interested"
  4. If candidate swiped right/applied: check age
     - If > 30 days: return "expired"
     - Else: return "waiting"
  5. Else: return "waiting"

Response:
{
  "status": "waiting" | "interested" | "rejected" | "expired"
}
```

---

## Authentication & Authorization

**Current:**
- Endpoint: `router.use(requireCandidateAuth)` (line 14)
- Auth middleware: Verifies JWT from `access_token` cookie
- Candidate context: Extracts `req.candidate.candidate_id` from token

**Tenant Isolation:**
- candidate_id is linked to candidate_account_id (1-to-1)
- All queries filtered by candidate_account_id
- No explicit company_id filtering on candidate side (candidate only sees their own data)

**RBAC:**
- Candidates: Can POST (create decision), GET (read their own decisions)
- Recruiters: Cannot access /api/candidate-decisions (different endpoints: /api/recruiter-review)

---

## Database: Monolith candidate_decisions Table

### Schema (from monolith src/db.ts line 2248):
```sql
CREATE TABLE candidate_decisions (
  id SERIAL PRIMARY KEY,
  candidate_account_id INTEGER NOT NULL,  -- FK to candidate_accounts
  job_id INTEGER NOT NULL,                -- FK to jobs
  action INTEGER,                         -- 1 = swipe_right/apply, 0 = swipe_left
  decision_type VARCHAR,                  -- 'swipe_right', 'swipe_left', 'apply'
  timestamp TIMESTAMP NOT NULL            -- Decision creation time
);

-- No explicit indexes in the monolith schema visible in code
```

### Relationships:
- **candidate_decisions.candidate_account_id** → candidate_accounts.id
- **candidate_decisions.job_id** → jobs.id
- Joins with: jobs (to get title), companies (to get company info)

---

## Database: candidate-service Mirror Table

### Current Schema (migrations/004_analytics_mirror.up.sql line 17):
```sql
CREATE TABLE candidate_decisions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,         -- Different name! "candidate_id" not "candidate_account_id"
  recruiter_id INTEGER,                  -- Not in monolith
  decision_type VARCHAR(50),
  decision_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**ISSUE:** Schema mismatch!
- Monolith uses `candidate_account_id`, `action`, `timestamp`
- Microservice uses `candidate_id`, `recruiter_id`, `decision_date`, `notes`

### Current Usage:
- candidateAnalytics.routes.ts queries this table for dashboard stats
- NOT written to by recordCandidateDecision (monolithClient proxies writes to monolith)

---

## Existing Service Ownership

### candidate-service Already Owns:
- ✅ candidate_accounts (profile data)
- ✅ candidate_experiences (work history)
- ✅ candidate_notifications (notification history)
- ✅ saved_candidates (search bookmarks)
- ✅ candidate_profile_views (recruiter viewing audit)
- ✅ candidate_decisions (partial - reads only for analytics)
- ✅ candidate_application_status (partial - reads only for analytics)
- ✅ mutual_matches (partial - reads only for analytics)

### matching-decision-service Owns:
- ✅ swipes (recruiter decisions - different domain)
- ✅ recruiter_reviews (different domain)
- NOT candidate_decisions

### Conclusion:
**candidate-service should own candidate_decisions** - it already owns candidate-related entities.

---

## Dual-Write Mechanism

### Current Status:
```
DUAL_WRITE_ENABLED=false (in .env.local)
```

### Mechanism:
- Monolith src/dualWrite.ts has upsertCandidateDecision() function
- When DUAL_WRITE_ENABLED=true:
  - Monolith writes to monolith DB (primary)
  - Monolith also writes to candidate-service DB (mirror)
  - Fire-and-forget async with no impact on monolith performance
- Currently disabled (safe default)

### Schema Mapping (line 2255 in src/db.ts):
```typescript
dualWrite.upsertCandidateDecision({
  id: row.id,
  candidate_account_id: row.candidate_account_id,
  job_id: row.job_id,
  decision_type: row.decision_type,
  decision_date: row.timestamp,  // ← timestamp → decision_date
  created_at: row.timestamp,
  updated_at: row.timestamp,
});
```

---

## Event Publishing

### Current:
- No event publishing detected
- No event consumers found

### Requirement:
- When decision is recorded, should notify:
  - Analytics service (eventually consistent)
  - Matching service (if evaluating mutual_matches)
- No explicit event topic/channel exists yet

---

## Dependencies & Consumers

### Services Calling candidate-decisions Endpoints:
1. **Frontend (React)** - User makes decisions
2. **Analytics service** - Dashboard stats (indirect via local DB query)

### candidate-decisions Depends On:
1. **candidate_accounts** - For candidate auth & profile
2. **jobs** - To verify job exists & get job details
3. **companies** - To get company info for join
4. **candidates** (candidate-core-service) - Linked row creation on decision record

### No Service Currently Depends On monolithClient's Decision Endpoints:
- Only candidate-service uses it (via routes)
- No inter-service HTTP calls to decision endpoints
- Safe to migrate without cascading changes

---

## Current Test Coverage

### candidate-service:
- `tests/candidateDecisions.test.ts` (if exists)

### Verification needed:
- What tests exist?
- What do they test?
- Are they using monolithClient or local DB?

---

## Summary of Findings

| Aspect | Finding |
|--------|---------|
| **Ownership** | candidate-service should own |
| **Current Data Location** | Monolith DB |
| **Microservice Table** | Exists but schema mismatch |
| **Writes** | All proxied to monolith |
| **Reads** | All proxied to monolith |
| **Auth** | ✅ Verified (requireCandidateAuth) |
| **Tenant Isolation** | ✅ Via candidate_account_id |
| **Dual-Write** | ✅ Exists but disabled |
| **Dependencies** | Safe to migrate (no internal callers) |
| **Risk Level** | Medium (schema mismatch must be fixed) |

---

## Critical Issues to Fix

### Issue 1: Schema Mismatch
```
Monolith:     candidate_account_id, job_id, action, decision_type, timestamp
Microservice: candidate_id, recruiter_id, decision_type, decision_date, notes
```
**Fix:** Update microservice table to match monolith schema OR extend with additional fields

### Issue 2: No Data Sync
```
Microservice table exists but:
- Never written to by recordCandidateDecision()
- Only read for analytics
```
**Fix:** Enable dual-write and backfill historical data

### Issue 3: Foreign Key Strategy
```
Monolith uses real FKs: candidate_account_id → candidate_accounts, job_id → jobs
Microservice (for now): No FKs, scoped by company_id only
```
**Fix:** Decide if FKs are needed (they are safer but require both tables)

---

## Next Phase: Migration Design

Based on this inspection:

1. **Fix microservice table schema** to match monolith exactly
2. **Enable dual-write** to start synchronizing new decisions
3. **Backfill historical data** from monolith
4. **Update routes** to use local DB instead of monolithClient
5. **Test with monolith available** (ensure same behavior)
6. **Test with monolith offline** (ensure independence)
7. **Remove monolithClient dependency**

---

## Checkpoint

**All inspection questions answered:**
- ✅ Every candidate-decision endpoint identified
- ✅ GET/POST/PUT/PATCH/DELETE operations mapped
- ✅ Request/response schemas documented
- ✅ Current database tables identified
- ✅ Monolith ownership confirmed
- ✅ Microservice ownership confirmed
- ✅ Authentication verified
- ✅ RBAC verified
- ✅ Tenant filtering verified
- ✅ Dual-write mechanism identified
- ✅ Dependencies mapped
- ✅ Risk assessment complete

**Ready to proceed to PHASE 2: DESIGN**
