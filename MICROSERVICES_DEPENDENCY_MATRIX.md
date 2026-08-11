# TEJOMA MICROSERVICES DEPENDENCY MATRIX

**Document Type**: Technical Architecture Analysis  
**Audit Date**: 2026-08-11  
**Status**: CRITICAL DEPENDENCIES IDENTIFIED

---

## DIRECT DATABASE ACCESS DEPENDENCIES

### Monolith → Service Database Write Dependencies

The monolith directly opens connections to and writes to the following service databases:

```
MONOLITH (app:3006, tejoma_recruiting)
│
├─ ↔ tejoma_identity (identity-service)
│   Writes: users, refresh_tokens, password_history
│   Purpose: Dual-write during login flow
│   Risk: CRITICAL - Authentication data owned by monolith
│
├─ ↔ tejoma_tenant_directory (tenant-directory-service)
│   Writes: companies, registrations, memberships
│   Purpose: Dual-write during registration
│   Risk: HIGH - Company data not owned by service
│
├─ ↔ tejoma_platform_governance (platform-governance-service)
│   Writes: company_registrations, approval_rules
│   Purpose: Dual-write during registration approval
│   Risk: HIGH - Governance data not owned by service
│
├─ ↔ tejoma_candidate (candidate-service)
│   Writes: candidate_accounts, candidate_experiences, candidate_notifications
│   Purpose: Dual-write during candidate profile updates
│   Risk: CRITICAL - Candidate data not owned by service
│
├─ ↔ tejoma_chat (chat-service)
│   Writes: conversations, messages, message_attachments
│   Purpose: Dual-write during chat message flow
│   Risk: HIGH - Chat data not owned by service
│
├─ ↔ tejoma_recruiting_service (recruiting-service)
│   Writes: recruiter_notifications, match_notifications
│   Purpose: Dual-write during notification creation
│   Risk: CRITICAL - Notifications not owned by service
│
├─ ↔ tejoma_matching_evaluation (matching-evaluation-service)
│   Writes: match_evaluation_runs, ltr_model_versions, career_trajectories, reasoning_conclusions
│   Purpose: Dual-write during ML evaluation and training
│   Risk: HIGH - ML evaluation data not owned by service
│
├─ ↔ tejoma_matching_reasoning (matching-reasoning-service)
│   Writes: skill_nodes, skill_edges, reasoning_conclusions, career_trajectories
│   Purpose: Dual-write during reasoning computation
│   Risk: HIGH - Reasoning data not owned by service
│
├─ ↔ tejoma_matching_skill_discovery (matching-skill-discovery-service)
│   Writes: skill_nodes (mirrored)
│   Purpose: Dual-write from skill discovery process
│   Risk: MEDIUM - Skills data created by monolith
│
├─ ↔ tejoma_role_intelligence (role-intelligence-service)
│   Writes: role_profiles (mirrored)
│   Purpose: Dual-write from role intelligence process
│   Risk: MEDIUM - Role data created by monolith
│
├─ ↔ tejoma_career_intelligence (career-intelligence-service)
│   Writes: role_profiles (mirrored), career_trajectories (mirrored)
│   Purpose: Dual-write from career path analysis
│   Risk: MEDIUM - Career data created by monolith
│
├─ ↔ tejoma_dynamic_weighting (dynamic-weighting-service)
│   Writes: skill_nodes, role_profiles, skill_edges (all mirrored)
│   Purpose: Dual-write from weighting computations
│   Risk: MEDIUM - Weighting data created by monolith
│
├─ ↔ tejoma_job (job-service)
│   Writes: jobs, job_descriptions, job_requirements
│   Purpose: Dual-write during job CRUD operations
│   Risk: CRITICAL - Job data not owned by service
│
├─ ↔ tejoma_candidate_core (candidate-core-service)
│   Writes: candidates, candidate_documents, candidate_qualifications
│   Purpose: Dual-write during candidate creation/update
│   Risk: CRITICAL - Candidate data not owned by service
│
├─ ↔ tejoma_matching_decision (matching-decision-service)
│   Writes: swipes, recruiter_notes, detailed_scoring_reports
│   Purpose: Dual-write during swipe/decision recording
│   Risk: CRITICAL - Decision data not owned by service
│
└─ ↔ tejoma_resume (resume-service)
    Writes: resume_documents, resume_parsed_data, extracted_skills
    Purpose: Dual-write during resume processing
    Risk: HIGH - Resume data not owned by service
```

---

## DEPENDENCY CLASSIFICATION

### Critical Data Ownership Violations

**Services where monolith OWNS data** (monolith is source of truth):

1. **identity-service** - Users, authentication
2. **candidate-service** - Candidate profiles  
3. **candidate-core-service** - Candidate records
4. **job-service** - Job listings
5. **matching-decision-service** - Swipe decisions
6. **recruiting-service** - Notifications
7. **chat-service** - Chat messages

### Medium Risk Mirrors

**Services where monolith mirrors data** (monolith creates, service receives copy):

- matching-evaluation-service
- matching-reasoning-service  
- career-intelligence-service
- role-intelligence-service
- matching-skill-discovery-service
- dynamic-weighting-service

---

## SERVICE-TO-SERVICE DEPENDENCIES

### Through API Gateway

```
Service A
    ↓
API Gateway (4000)
    ↓
Service B (HTTP/REST)
```

This pattern is USED for:
- Candidate searches
- Recruiter reviews
- Job updates
- Match explanations
- Chat messages

This pattern avoids direct database access. ✅ GOOD

### DIRECT Database Access (VIOLATION)

```
Monolith → Service Database
```

This pattern is PROBLEMATIC because:
- Services are not authoritative for their own data
- Services cannot operate independently
- Monolith is single point of failure for data persistence
- Violates microservice principle of data ownership

---

## HTTP Interservice Dependencies

### Verified Dependencies (from grep of source code):

| From | To | Method | Endpoint | Purpose |
|------|----|----|------|----|
| monolith | identity-service | HTTP | /internal/verify-token | Token validation |
| monolith | candidate-service | HTTP | /internal/* | Candidate searches |
| monolith | job-service | HTTP | /internal/* | Job queries |
| monolith | matching-* | HTTP | Various | Scoring, reasoning |
| matching-decision-service | matching-evaluation | HTTP | /score | Match scoring |
| recruiting-service | candidate-service | HTTP | /internal/* | Candidate data |
| chat-service | resume-service | HTTP | /internal/* | Resume content |
| job-service | jd-parser-service | HTTP | /parse-description | JD parsing |

---

## REDIS DEPENDENCIES

### Pub/Sub Events

```
Service A → Redis → Service B (through pub/sub)
```

**Event Topics**:
- job-created
- candidate-updated
- swipe-completed
- decision-changed
- match-scored
- notification-sent

**Assessment**: ✅ Event-driven is GOOD pattern

**Issue**: Used for read-only notifications, not for primary data flow.

---

## EXTERNAL SERVICE DEPENDENCIES

### External ML/NLP Services

```
Monolith / matching-services
    ↓
jd-nlp-service (port 8008)
  - JD parsing
  - Skill extraction

matching-ml-service (port 8009)
  - ML inference
  - Embedding generation

(Python-based services)
```

**Assessment**: Acceptable - external business logic

---

## CRITICAL DEPENDENCY VIOLATIONS

### Violation #1: Monolith Data Ownership

**Architecture**:
```
Monolith writes to:
- tejoma_identity ❌
- tejoma_candidate ❌
- tejoma_job ❌
- tejoma_matching_decision ❌
- tejoma_recruiting_service ❌
- ... [13 more]
```

**Should be**:
```
Service owns writes to:
- tejoma_identity ✅
- tejoma_candidate ✅
- tejoma_job ✅
- tejoma_matching_decision ✅
- tejoma_recruiting_service ✅
- ... [all services own writes]
```

### Violation #2: Read-Only Services

**Current**:
```
Service.query() → Monolith's copy of data
```

**Problem**: Services cannot rely on their own database as source of truth

### Violation #3: Synchronous Cascading Writes

**Current**:
```
Monolith write to tejoma_recruiting ✅
    ↓
Dual-write to tejoma_identity (fire-and-forget)
    ↓
Dual-write to tejoma_candidate (fire-and-forget)
    ↓
... [continue for all services]
```

**Risk**: If monolith crashes during dual-writes:
- Primary write succeeded ✅
- Secondary writes may have partially succeeded ❌
- Data inconsistency across services ❌

---

## WHAT INDEPENDENT MICROSERVICES WOULD LOOK LIKE

### True Service Autonomy Pattern

```
Client
    ↓
API Gateway
    ↓
Service A (HTTP)
    ├─ tejoma_a (owned, authoritative)
    ├─ Publishes events to Redis
    └─ Calls Service B via HTTP when needed

Service B (HTTP)
    ├─ tejoma_b (owned, authoritative)
    ├─ Subscribes to Service A events
    └─ Responds to Service A HTTP requests

Service C (HTTP)
    ├─ tejoma_c (owned, authoritative)
    └─ Independent lifecycle
```

### Key Differences

**Current (Monolithic with Containers)**:
- Monolith owns all data
- Services are read-only replicas
- Monolith must run for data persistence
- Services cannot be independently deployed

**True Microservices**:
- Each service owns its data
- Services are authoritative for their domain
- Each service can run independently
- Independent deployment cycles
- Communicate through APIs or events

---

## SUMMARY

### Dependency Chain

```
HIGH DEPENDENCY: Every service depends on monolith for data persistence

Monolith (single point of failure) 
    ↓↓↓ Direct DB writes ↓↓↓
All 18+ service databases
    ↓
Services (read-only from their perspective)
    ↓
Client requests
```

### Independence Score

| Dimension | Current | Target | Gap |
|-----------|---------|--------|-----|
| Data Ownership | Monolith | Service | CRITICAL |
| Deployment | Coupled | Independent | CRITICAL |
| Failure Isolation | Cascading | Isolated | HIGH |
| Data Consistency | Dual-write risk | Event-driven | MEDIUM |

**Overall**: Services are NOT independent microservices. They are containers deployed independently but architecturally coupled to monolith for data ownership.

