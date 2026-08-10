# PHASE 1: Monolith Dependency Audit

**Date**: August 10, 2026  
**Status**: AUDIT COMPLETE

---

## Executive Summary

The Tejoma system has **systematic dual-write architecture** where:
- **Primary writes**: Microservice own database (authoritative)
- **Secondary writes**: Monolith database (via /internal/* mirror endpoints)
- **Reads**: Mix of microservice-only and monolith-proxy

**Key Finding**: Almost every microservice has a monolithClient.ts that mirrors writes to the monolith OR proxies reads from the monolith. This is intentional and part of the migration design.

---

## Monolith Dependency Types

### Type A: Mirror-Write Services
**Pattern**: Write to own DB (succeeds) → Call monolith /internal/* (non-fatal)

Services using mirror pattern:
1. **job-service** → monolith `/internal/job/jobs/mirror-and-notify`, `/internal/job/jobs/mirror-delete`
2. **candidate-core-service** → monolith `/internal/candidate-core/candidates/mirror-and-notify`, `/internal/candidate-core/candidates/mirror-delete`
3. **matching-decision-service** → monolith `/internal/matching-decision/swipes/mirror-and-notify`, `/internal/matching-decision/notes/mirror-and-notify`
4. **matching-skill-discovery-service** → mirrors unknown skill discoveries
5. Other services → mirror their writes

**Purpose**: Keep monolith synchronized for fallback capability

**Failure Mode**: If monolith mirror call fails, service write succeeds but monolith becomes stale (logged as warning, not fatal)

**Can Remove**: YES (when fallback not needed)

### Type B: Proxy Services
**Pattern**: Microservice reads from monolith on specific queries

Services using proxy pattern:
1. **analytics-service** → monolith `/internal/analytics/dashboard`, `/internal/analytics/job/`, `/internal/analytics/recruiter-profile`, `/internal/analytics/skills`
   - Proxies: Dashboard queries, job analytics, recruiter profiles, skill distributions
   
2. **matching-decision-service** → monolith `/internal/matching-decision/recruiter-review/list`, `/internal/matching-decision/recruiter-review/detail`
   - Proxies: Recruiter review listings, detailed scoring

3. **career-intelligence-service** → monolith for career trajectory data

4. **matching-reasoning-service** → monolith for reasoning conclusions

**Purpose**: Query aggregated/complex data from monolith

**Failure Mode**: If monolith unreachable, query fails (can be mitigated with fallback)

**Can Remove**: PARTIAL
   - Analytics queries: Can be moved to microservice reads (CQRS ready)
   - Career trajectory / reasoning: Keep on monolith (deliberately)

### Type C: Gateway Fallback
**Pattern**: API Gateway routes unmatched paths to monolith

**Routes**:
- 40 explicit microservice routes in ROUTES table
- All other paths → fallback to monolith

**Purpose**: Keep unimplemented features working via monolith

**Failure Mode**: If monolith unreachable, unimplemented features fail (404)

**Can Remove**: YES (when all routes migrated)

### Type D: Static Asset Serving
**Pattern**: Monolith serves SPA files (index.html, main.js, styles.css)

**Purpose**: Host React application

**Failure Mode**: If monolith down, SPA can't load

**Can Remove**: NO (need static server - but could be nginx)

**Alternative**: Move static assets to nginx or separate CDN

### Type E: Career Trajectory & Reasoning Data
**Pattern**: Monolith exclusively stores and serves these

**Tables**: career_trajectories, reasoning_conclusions

**Purpose**: Deliberately kept on monolith by design

**Failure Mode**: Queries fail if monolith down

**Can Remove**: NO (by design - complex reasoning logic stays on monolith)

---

## Evidence Table: Monolith Dependencies by Feature

| Feature | Microservice | Service DB | Monolith Call | Type | Read? | Write? | Dual-Write? | Reason | Can Disable? |
|---------|---|---|---|---|---|---|---|---|---|
| **Candidates** | candidate-core-service | tejoma_candidate_core | /internal/candidate-core/candidates/mirror-and-notify | Mirror-Write | ✓ Own DB | ✓ Own + Mirror | YES | Fallback consistency | YES |
| **Jobs** | job-service | tejoma_job | /internal/job/jobs/mirror-and-notify | Mirror-Write | ✓ Own DB | ✓ Own + Mirror | YES | Fallback consistency | YES |
| **Swipes** | matching-decision-service | tejoma_matching_decision | /internal/matching-decision/swipes/mirror-and-notify | Mirror-Write | ✓ Own DB | ✓ Own + Mirror | YES | Fallback consistency | YES |
| **Recruiter Notes** | matching-decision-service | tejoma_matching_decision | /internal/matching-decision/notes/mirror-and-notify | Mirror-Write | ✓ Own DB | ✓ Own + Mirror | YES | Fallback consistency | YES |
| **Analytics Dashboard** | analytics-service | tejoma_analytics | /internal/analytics/dashboard | Proxy | ✗ Monolith | ✗ None | NO | Complex query aggregation | PARTIAL (migrate to CQRS) |
| **Job Analytics** | analytics-service | tejoma_analytics | /internal/analytics/job/:id | Proxy | ✗ Monolith | ✗ None | NO | Complex query aggregation | PARTIAL (migrate to CQRS) |
| **Recruiter Profile** | analytics-service | tejoma_analytics | /internal/analytics/recruiter-profile | Proxy | ✗ Monolith | ✗ None | NO | Complex query aggregation | PARTIAL (migrate to CQRS) |
| **Skills Analytics** | analytics-service | tejoma_analytics | /internal/analytics/skills | Proxy | ✗ Monolith | ✗ None | NO | Complex query aggregation | PARTIAL (migrate to CQRS) |
| **Recruiter Review List** | matching-decision-service | tejoma_matching_decision | /internal/matching-decision/recruiter-review/list | Proxy | ✗ Monolith | ✗ None | NO | Complex mutual-match logic | YES (alternate: migrate query) |
| **Recruiter Review Detail** | matching-decision-service | tejoma_matching_decision | /internal/matching-decision/recruiter-review/detail | Proxy | ✗ Monolith | ✗ None | NO | Complex scoring logic | YES (alternate: migrate query) |
| **Career Trajectory** | career-intelligence-service | tejoma_career_intelligence | /internal/career/trajectory | Proxy | ✗ Monolith | ✗ None | NO | Complex reasoning - KEPT ON MONOLITH BY DESIGN | NO |
| **Reasoning Conclusions** | matching-reasoning-service | tejoma_matching_reasoning | /internal/reasoning/conclusions | Proxy | ✗ Monolith | ✗ None | NO | Complex reasoning - KEPT ON MONOLITH BY DESIGN | NO |
| **Static Assets** | nginx (fallback to monolith) | N/A | Serves from monolith | Fallback | ✗ Monolith | ✗ None | NO | SPA HTML/JS/CSS | PARTIAL (move to nginx) |
| **Unmatched Routes** | api-gateway | N/A | Fallback to monolith | Fallback | ✗ Monolith | ✗ None | NO | Legacy features | YES (when migrated) |

---

## Monolith Endpoint Inventory

### Mirror Endpoints (Non-Fatal Failures)
```
POST /internal/job/jobs/mirror-and-notify (job-service → monolith)
POST /internal/job/jobs/mirror-delete (job-service → monolith)
POST /internal/candidate-core/candidates/mirror-and-notify (candidate-core → monolith)
POST /internal/candidate-core/candidates/mirror-delete (candidate-core → monolith)
POST /internal/matching-decision/swipes/mirror-and-notify (matching-decision → monolith)
POST /internal/matching-decision/notes/mirror-and-notify (matching-decision → monolith)
POST /internal/matching-decision/detailed-scores/mirror-and-notify (matching-decision → monolith)
+ other services' mirror endpoints
```

### Proxy Endpoints (Read-Only Queries)
```
GET /internal/analytics/dashboard?companyId=X
GET /internal/analytics/job/:id?companyId=X
GET /internal/analytics/recruiter-profile?userId=X&companyId=Y
GET /internal/analytics/skills?companyId=X
GET /internal/matching-decision/recruiter-review/list
GET /internal/matching-decision/recruiter-review/detail
GET /internal/career/trajectory/:candidateId
GET /internal/reasoning/conclusions/:subjectType/:subjectId
```

### Fallback Routes (API Gateway)
```
All routes not in ROUTES table → http://monolith:3001
Examples:
  GET /api/realtime/stream → monolith (SSE)
  GET /api/explainability -> monolith
  POST /api/explainability -> monolith
  (plus any undocumented endpoints)
```

---

## Feature Flags Controlling Monolith Dependency

Current environment (.env.local):

```bash
DUAL_WRITE_ENABLED=true
CANDIDATE_ANALYTICS_CUTOVER_ENABLED=true
RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=true
RECRUITER_MATCHES_CUTOVER_ENABLED=true
MONOLITH_INTERNAL_URL=http://localhost:3006
```

**What these flags control**:
- DUAL_WRITE_ENABLED=true → Services mirror writes to monolith
- DUAL_WRITE_ENABLED=false → Services stop mirroring (microservice-only)
- Analytics cutover flags → Can switch between proxy and local reads
- Review/matches cutover → Can switch between microservice and monolith handling

---

## Database Ownership Inventory

| Service | Database | Primary Tables | Status |
|---------|----------|---|---|
| candidate-core-service | tejoma_candidate_core | candidates | ✅ Authoritative |
| job-service | tejoma_job | jobs | ✅ Authoritative |
| matching-decision-service | tejoma_matching_decision | swipes, recruiter_notes | ✅ Authoritative |
| matching-evaluation-service | tejoma_matching_evaluation | evaluation_scores | ✅ Authoritative |
| matching-scoring-service | tejoma_matching_scoring | model_configs, trained_models | ✅ Authoritative |
| matching-skill-discovery-service | tejoma_matching_skill_discovery | unknown_skills | ✅ Authoritative |
| analytics-service | tejoma_analytics | analytics_events, aggregates | ✅ Authoritative |
| candidate-service | tejoma_candidate | candidate_accounts | ✅ Authoritative |
| identity-service | tejoma_identity | users, refresh_tokens | ✅ Authoritative |
| resume-service | tejoma_resume | resume_storage | ✅ Authoritative |
| chat-service | tejoma_chat | chat_sessions, messages | ✅ Authoritative |
| career-intelligence-service | tejoma_career_intelligence | (local cache) | ⚠️ Proxies to monolith |
| matching-reasoning-service | tejoma_matching_reasoning | (local cache) | ⚠️ Proxies to monolith |
| monolith | tejoma_recruiting | candidates, jobs, swipes, etc. | ⚠️ Mirror/fallback |

---

## Monolith Dependency Removal Checklist

| Dependency | Type | Status | Prerequisite | Action |
|---|---|---|---|---|
| Mirror writes (job-service) | Mirror-Write | ACTIVE | Dual-write flag | Disable DUAL_WRITE_ENABLED |
| Mirror writes (candidate-core-service) | Mirror-Write | ACTIVE | Dual-write flag | Disable DUAL_WRITE_ENABLED |
| Mirror writes (matching-decision-service) | Mirror-Write | ACTIVE | Dual-write flag | Disable DUAL_WRITE_ENABLED |
| Analytics proxy queries | Proxy | ACTIVE | Migrate to CQRS | Disable analytics proxy in code |
| Recruiter review proxy | Proxy | ACTIVE | Migrate query logic | Disable review proxy in code |
| Career trajectory data | Proxy | ACTIVE | KEEP BY DESIGN | Do NOT disable |
| Reasoning conclusions data | Proxy | ACTIVE | KEEP BY DESIGN | Do NOT disable |
| Gateway fallback | Fallback | ACTIVE | Migrate remaining features | Remove fallback route |
| Static asset serving | Fallback | ACTIVE | Move to nginx | Update nginx config |

---

## PHASE 1 Conclusion

**Total Monolith Dependencies Identified**: 13 major types

**Categorization**:
- **Mirror-Write**: 3+ services (non-fatal if fails)
- **Proxy Reads**: 4+ types (query aggregation)
- **Deliberately Kept**: 2 types (career trajectory, reasoning)
- **Gateway Fallback**: 2 types (unmatched routes, static assets)

**Ready for Phase 2**: YES

**Next Step**: Verify microservice database ownership and consistency

