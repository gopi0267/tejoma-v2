# PHASE 2: Microservice Database Ownership Verification

**Date**: August 10, 2026  
**Status**: VERIFIED (by configuration and architectural review)

---

## Database Configuration Review

### PostgreSQL Setup

- **Host**: `host.docker.internal` (Windows host machine)
- **User**: postgres (from .env.local)
- **Connection**: All services connect via host.docker.internal from Docker network
- **Schema**: PostgreSQL database per service (verified in docker-compose.yml)

### Service Database Assignments (from docker-compose.yml)

```
analytics-service      → tejoma_analytics
candidate-core-service → tejoma_candidate_core
candidate-service      → tejoma_candidate
chat-service          → tejoma_chat
career-intelligence-service → tejoma_career_intelligence
dynamic-weighting-service → tejoma_dynamic_weighting
identity-service      → tejoma_identity
job-service           → tejoma_job
matching-bge-service  → tejoma_matching_bge_shadow
matching-decision-service → tejoma_matching_decision
matching-evaluation-service → tejoma_matching_evaluation
matching-reasoning-service → tejoma_matching_reasoning
matching-scoring-service → tejoma_matching_scoring
matching-skill-discovery-service → tejoma_matching_skill_discovery
platform-governance-service → tejoma_platform_governance
recruiting-service    → tejoma_recruiting_service
resume-service        → tejoma_resume
jd-parser-service     → tejoma_jd_parser
jd-nlp-service        → (Python service, shared models)
matching-ml-service   → (Python service, shared models)
```

**Monolith Database**:
```
app (monolith)        → tejoma_recruiting
```

---

## Data Ownership Verification

### Primary Ownership: By Design

Each service owns specific business entities:

| Service | Primary Entity | Database | Authoritative |
|---------|---|---|---|
| candidate-core-service | Candidates (recruiter-uploaded) | tejoma_candidate_core | ✅ YES |
| job-service | Jobs | tejoma_job | ✅ YES |
| matching-decision-service | Swipes, Recruiter Notes, Scoring Decisions | tejoma_matching_decision | ✅ YES |
| identity-service | Users, Refresh Tokens | tejoma_identity | ✅ YES |
| analytics-service | Analytics Events, Aggregates (CQRS read model) | tejoma_analytics | ✅ YES |
| resume-service | Resume Storage, Metadata | tejoma_resume | ✅ YES |
| recruiting-service | Recruiter-specific data | tejoma_recruiting_service | ✅ YES |
| candidate-service | Candidate Accounts (self-service) | tejoma_candidate | ✅ YES |
| matching-evaluation-service | Evaluation Scores, Shadow Data | tejoma_matching_evaluation | ✅ YES |
| matching-scoring-service | ML Model Configs, Trained Models | tejoma_matching_scoring | ✅ YES |
| matching-skill-discovery-service | Unknown Skills, Discoveries | tejoma_matching_skill_discovery | ✅ YES |
| chat-service | Chat Sessions, Messages | tejoma_chat | ✅ YES |
| career-intelligence-service | Career Intelligence (cache/proxies) | tejoma_career_intelligence | ⚠️ Proxies to monolith |
| matching-reasoning-service | Reasoning Data (cache/proxies) | tejoma_matching_reasoning | ⚠️ Proxies to monolith |

---

## Dual-Write Verification

### Mirror-Write Pattern (Primary → Monolith)

**Enabled** by feature flag: `DUAL_WRITE_ENABLED=true`

Services performing mirror writes:

1. **job-service**
   - Primary write: `tejoma_job.jobs` (own database)
   - Mirror write: `tejoma_recruiting.jobs` (monolith)
   - Implementation: `monolithClient.mirrorAndNotifyJobCreate/Update/Delete`
   - Failure mode: Non-fatal (logged as warning, microservice write succeeds)

2. **candidate-core-service**
   - Primary write: `tejoma_candidate_core.candidates` (own database)
   - Mirror write: `tejoma_recruiting.candidates` (monolith)
   - Implementation: `monolithClient.mirrorAndNotifyCandidateCreate/Delete`
   - Failure mode: Non-fatal (logged as warning, microservice write succeeds)

3. **matching-decision-service**
   - Primary write: `tejoma_matching_decision.swipes` (own database)
   - Mirror write: `tejoma_recruiting.swipes` (monolith)
   - Primary write: `tejoma_matching_decision.recruiter_notes` (own database)
   - Mirror write: `tejoma_recruiting.recruiter_notes` (monolith)
   - Implementation: `monolithClient.mirrorAndNotifySwipe/RecruiterNote/DetailedScore`
   - Failure mode: Non-fatal (logged as warning, microservice write succeeds)

4. **Other services**
   - Similar mirror-write pattern for their respective entities
   - All non-fatal failures (service write succeeds, mirror may fail)

---

## Data Consistency Status

### Expected State (Current Configuration)

Given `DUAL_WRITE_ENABLED=true`:

```
For every write operation on microservice entity:
  1. Write to microservice database (PRIMARY - must succeed)
  2. Call monolith /internal/* mirror endpoint (SECONDARY - may fail)
  
For reads:
  - Microservices read from their own database (authoritative)
  - Analytics queries proxy to monolith (temporary, can be migrated)
```

### Drift Tolerance

**Acceptable drift** when dual-write is active:
- Monolith may have stale copies (if mirror call failed)
- Microservice database is always authoritative
- Mirror failures are logged but don't propagate to client

**Unacceptable drift**:
- Duplicate records in microservice database
- Missing records in microservice database
- Unexpected writes directly to monolith (not via mirror)

### How We Will Verify Consistency

Instead of querying databases directly (which requires direct DB access), we will verify consistency by:

1. **Phase 3**: Test controlled service failures and recovery
2. **Phase 4**: Prepare for microservice-only mode (verify all prerequisites)
3. **Phase 5**: Run actual staging test with dual-write OFF
4. **Phase 6**: Run full browser test and observe data operations
5. **Phase 7**: Check data before/after counts and consistency

---

## Schema Review (From Service Source Code)

### candidate-core-service/db.ts

```
Primary table: candidates
  - id (primary key, service-assigned)
  - name, email, phone
  - skills, years_of_experience
  - current_location, preferred_location
  - current_company, current_job_title
  - and 20+ other fields
```

Status: ✅ **Owned by service, mirrored to monolith**

### job-service/db.ts

```
Primary table: jobs
  - id (primary key, service-assigned)
  - company_id, title, description
  - required_skills, salary_range
  - location, job_type
  - and 15+ other fields
```

Status: ✅ **Owned by service, mirrored to monolith**

### matching-decision-service/db.ts

```
Primary tables: 
  swipes (candidate-job interactions)
  recruiter_notes (recruiter feedback)
  recruiter_decisions (accept/reject/save)
```

Status: ✅ **Owned by service, mirrored to monolith**

---

## Consistency Verification Plan (Will Execute in Phase 5-7)

### When dual-write is DISABLED (Phase 5):

1. **Check for orphaned records**
   - Records in monolith not in microservice (old data)
   - Records in microservice not in monolith (recent data since cutover)

2. **Check for duplicates**
   - Same record ID appearing multiple times
   - Same data with different IDs

3. **Check sequence integrity**
   - Record IDs generated correctly
   - No missing IDs in sequence

4. **Check referential integrity**
   - Jobs reference valid company IDs
   - Swipes reference valid candidate/job IDs
   - Recruiter notes reference valid swipes

### Expected Results When Microservice-Only

- ✅ All primary data in microservice databases
- ✅ No unexpected writes to monolith (since dual-write OFF)
- ✅ No data loss
- ✅ No duplicate records
- ✅ Referential integrity maintained

---

## PHASE 2 Conclusion

### Verification Status: ✅ **VERIFIED BY DESIGN**

**Evidence**:
1. Each service has dedicated database (verified in docker-compose.yml)
2. Each service is primary owner of its entity (verified in service code)
3. Dual-write pattern is implemented consistently (verified in monolithClient.ts)
4. Mirror writes are non-fatal (verified in error handling)
5. Fallback to monolith is available (verified in gateway configuration)

### Readiness for Phase 3: YES

All microservices have clear database ownership and dual-write capability.

### Actual Data Consistency Verification:
Will be confirmed during:
- Phase 5: Staging microservice-only test
- Phase 6: Full browser test
- Phase 7: Data consistency check after operations

---

**Status**: Database ownership verified, ready for Phase 3 (Controlled Failure Testing)

