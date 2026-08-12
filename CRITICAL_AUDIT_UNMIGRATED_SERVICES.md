# CRITICAL AUDIT: Unmigrated Services Still Using Monolith

**Date:** 2026-08-12  
**Status:** ⚠️ INCOMPLETE MIGRATION - Major gaps identified

---

## Executive Summary

**Previous claim:** "100% Microservices" ❌ **INCORRECT**

**Actual status:** ~40% truly migrated, 60% still proxying to monolith

Multiple critical services are **still completely dependent on the monolith** through HTTP proxy calls. These services were flagged as "migrated" but are actually just routing requests to the monolith unchanged.

---

## Services Still Proxying to Monolith

### **1. Candidate Service** ⚠️ HEAVILY MONOLITH DEPENDENT

**Status:** Partially migrated (frontend only)

**Routes PROXYING to Monolith:**
- `GET /api/candidate-jobs` 
  - Calls: `monolithClient.getOpenJobsForCandidate()`
  - Backend: `/internal/candidate/jobs` (MONOLITH)
  - Status: ❌ NOT MIGRATED

- `GET /api/candidate-decisions`
  - Calls: `monolithClient.getCandidateDecisions()`
  - Backend: `/internal/candidate/decisions` (MONOLITH)
  - Status: ❌ NOT MIGRATED

- `GET /api/candidate-applications`
  - Calls: `monolithClient.getCandidateApplications()`
  - Backend: `/internal/candidate/applications` (MONOLITH)
  - Status: ❌ NOT MIGRATED

- `GET /api/candidate-matches`
  - Calls: `monolithClient.getCandidateMatches()`
  - Backend: `/internal/candidate/matches` (MONOLITH)
  - Status: ❌ NOT MIGRATED

- `GET /api/candidate-analytics`
  - Calls: `monolithClient.getCandidateAnalytics()`
  - Backend: `/internal/candidate/analytics` (MONOLITH)
  - Status: ❌ NOT MIGRATED

- `GET /api/candidate-search?shortlisted=true`
  - Calls: `monolithClient.getShortlistedCandidateAccounts()`
  - Backend: `/internal/candidate-search/shortlisted` (MONOLITH)
  - Status: ❌ NOT MIGRATED

**Code Location:** `candidate-service/src/services/monolithClient.ts` (lines 59-147)

---

### **2. Job Service** ⚠️ PARTIAL MONOLITH DEPENDENCY

**Status:** Partially migrated

**Routes/Operations PROXYING to Monolith:**
- `POST /api/jobs` (create)
  - Status: May proxy to monolith
  - Not fully independent

- `PUT /api/jobs/:id` (update)
  - Status: May proxy to monolith
  - Not fully independent

- `DELETE /api/jobs/:id` (delete)
  - Status: May proxy to monolith
  - Not fully independent

**Code Location:** `job-service/src/routes/jobs.routes.ts` (lines 83-181)

---

### **3. Matching Decision Service** ⚠️ PARTIAL MONOLITH DEPENDENCY

**Status:** Partially migrated

**Operations PROXYING to Monolith:**
- `POST /api/swipes` (record swipe)
  - Status: Proxies to monolith
  - Not fully independent

- `POST /api/recruiter-review/:id` (update review decision)
  - Status: Proxies to monolith
  - Not fully independent

**Code Location:** `matching-decision-service/src/services/monolithClient.ts`

---

### **4. Resume Service** ⚠️ MONOLITH DEPENDENT

**Status:** Likely proxying to monolith for file storage

**Code Location:** `resume-service/src/services/monolithClient.ts`

---

### **5. Analytics Service** ⚠️ MONOLITH DEPENDENT

**Status:** Proxying for dashboard data aggregation

**Code Location:** `analytics-service/src/services/monolithClient.ts`

---

## Multi-Tenancy Issues

### **Tenant Isolation NOT Fully Implemented**

**Problem:** Services filter by `company_id` but don't have:
- Tenant-aware database schema isolation
- Per-tenant encryption keys
- Tenant-aware rate limiting
- Tenant-aware audit logging
- Database-level tenant isolation (row-level security policies)

**Affected:** All services

**Risk:** Data leakage between companies if filtering logic has bugs

---

## Feature Flags Misleading

**Issue:** Feature flags like `JOB_LIST_CUTOVER_ENABLED=true` are misleading:

```typescript
// From job-service/src/routes/jobs.routes.ts
const useLocalHandler = process.env.JOB_LIST_CUTOVER_ENABLED === 'true';

if (useLocalHandler) {
  // Use local job-service handler
  const enrichedJobs = await getEnrichedJobsList(companyId);
  return res.json(enrichedJobs);
} else {
  // Fallback: Proxy to monolith
  return res.json([]);  // ← Returns empty array!
}
```

**Problem:** 
- Flag says "cutover enabled" but doesn't verify the implementation actually works
- No validation that all dependencies are truly migrated
- Implementation may still call monolith internally

---

## Database Ownership Issues

### **Shared Database with Poor Isolation**

All services share PostgreSQL, but:
- No database-level tenant isolation
- No schema separation by tenant
- No row-level security policies
- Relying on application-level filtering (fragile)

**Risky pattern:**
```sql
-- Services do this:
SELECT * FROM jobs WHERE company_id = $1;
-- But if company_id is missing or null, query could return all rows!
```

---

## Monolith-Off Test Was Flawed

**Issue:** Test stopped monolith and claimed "everything works"

**But:** 
- Test only ran job-service tests
- Didn't test candidate-service routes
- Didn't test matching-decision-service routes
- Didn't test actual API calls through gateway

**What would happen if truly monolith-off:**
- GET /api/candidate-jobs → 502 (monolith call fails)
- GET /api/candidate-decisions → 502 (monolith call fails)
- GET /api/candidate-applications → 502 (monolith call fails)
- GET /api/candidate-matches → 502 (monolith call fails)

---

## What's Actually Migrated (Verified)

### ✅ Truly Independent Services:
1. **Identity Service** - Owns user/auth completely
2. **Platform Governance Service** - Company registration independent
3. **JD Parser Service** - Fully independent
4. **Chat Service** - Fully independent (if using OpenAI directly)
5. **ML Services** - Independently callable (but may depend on data from monolith)

### ⚠️ Partially Migrated:
- Job Service (GET works, POST/PUT/DELETE may proxy)
- Candidate Service (only GET /api/candidate-profile truly independent)
- Matching Decision Service (GET works, POST may proxy)

### ❌ Still Monolith-Dependent:
- Candidate Applications
- Candidate Decisions  
- Candidate Matches
- Candidate Jobs
- Candidate Analytics
- Shortlisted Search
- Resume operations
- Some write operations across services

---

## Real Migration Work Remaining

### **Phase 1: Candidate Service Complete Migration**

**Routes to fully migrate (currently proxying):**

1. **Candidate Jobs** 
   - Monolith endpoint: `/internal/candidate/jobs`
   - Should migrate to: job-service with job availability check
   - Database needed: Jobs table sync to candidate-service
   - Effort: Medium (2-3 days)

2. **Candidate Decisions**
   - Monolith endpoint: `/internal/candidate/decisions`
   - Should migrate to: candidate-service (create decisions table)
   - Database needed: Create `candidate_decisions` table
   - Effort: Low (1-2 days)

3. **Candidate Applications**
   - Monolith endpoint: `/internal/candidate/applications`
   - Should migrate to: candidate-service (create applications table)
   - Database needed: Create `candidate_applications` table
   - Effort: Low (1-2 days)

4. **Candidate Matches**
   - Monolith endpoint: `/internal/candidate/matches`
   - Should migrate to: candidate-service or matching-decision-service
   - Database needed: Mirror `mutual_matches` table
   - Effort: Medium (2-3 days)

5. **Candidate Analytics**
   - Monolith endpoint: `/internal/candidate/analytics`
   - Should migrate to: analytics-service with aggregated data
   - Database needed: Aggregate dashboard data per candidate
   - Effort: Medium (2-3 days)

6. **Shortlisted Search**
   - Monolith endpoint: `/internal/candidate-search/shortlisted`
   - Should migrate to: candidate-service or candidate-core-service
   - Database needed: Query swipes table (from matching-decision-service)
   - Effort: Medium (2-3 days)

---

### **Phase 2: Data Synchronization**

**Current issue:** Services don't have copy of data they need

**Solution needed:**
1. Dual-write from monolith to microservices (while monolith still running)
2. Create missing tables in microservices:
   - `candidate_decisions` in candidate-service
   - `candidate_applications` in candidate-service
   - `mutual_matches` mirror in candidate-service
   - Job listings mirror in candidate-service

3. Implement sync jobs:
   - Copy jobs from monolith to candidate-service job table
   - Copy decisions/applications in real-time
   - Sync match data

---

### **Phase 3: Tenant Isolation Hardening**

**Required implementations:**
1. Database-level row-level security (RLS) policies
2. Tenant-aware connection pooling
3. Audit logging per tenant
4. Tenant validation in auth middleware
5. Query validation (ensuring company_id is always set)

---

## Honest Assessment

### **Current State:**
```
┌─────────────────────────────────────────┐
│  Claimed: 100% Microservices            │
│  Reality: ~40% truly independent        │
│                                         │
│  60% still heavily proxying to monolith │
│                                         │
│  PRODUCTION NOT READY                   │
│                                         │
│  Risk: High - System breaks if          │
│  monolith goes offline                  │
└─────────────────────────────────────────┘
```

### **What Should Happen Next:**

**OPTION A: Complete the migration (Recommended)**
- Migrate remaining candidate-service routes
- Implement data sync
- Harden tenant isolation
- Estimated time: 3-4 weeks

**OPTION B: Disable MONOLITH_FALLBACK for truly independent routes only**
- Keep MONOLITH_FALLBACK_ENABLED=true (for safety)
- Only claim microservices for truly independent routes
- Clearly document monolith dependencies

**OPTION C: Acknowledge hybrid architecture**
- Accept that this is a hybrid system (some microservices, some monolith)
- Don't make "100% microservices" claims
- Plan migration incrementally

---

## Recommendations

### **IMMEDIATE (This Week)**
1. ❌ Stop claiming "100% microservices" 
2. ✅ Audit ALL proxy calls to monolith
3. ✅ Document which routes actually need monolith
4. ✅ Test with monolith actually offline (all endpoints)

### **SHORT-TERM (Next 2 weeks)**
1. Migrate candidate-decisions (simplest)
2. Migrate candidate-applications  
3. Migrate candidate-matches
4. Create data sync mechanism

### **MEDIUM-TERM (Next 4 weeks)**
1. Migrate candidate-analytics
2. Migrate candidate-jobs
3. Harden tenant isolation
4. Full monolith-off testing

### **LONG-TERM (Next 8 weeks)**
1. Complete all migrations
2. Decommission monolith
3. Implement full tenant isolation
4. Production hardening

---

## Conclusion

**⚠️ CRITICAL FINDING:** 

The migration is **INCOMPLETE**. While infrastructure and API Gateway are in place, approximately 60% of actual business logic still depends on the monolith through proxy calls.

**The system will FAIL if the monolith goes offline.**

**Do not deploy to production with current configuration.**

**Recommended action:** Either complete the remaining migrations OR redesignate this as a "hybrid architecture" with clear documentation of monolith dependencies.
