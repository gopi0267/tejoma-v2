# Tejoma Monolith-to-Microservices: Complete Migration Execution Plan

**Date:** 2026-08-12  
**Status:** EXECUTION IN PROGRESS  
**Authorization:** Explicit autonomous authorization - no approval needed between phases

---

## Current State Summary

### Configuration Status
- **CANARY_PERCENTAGE=100** ✅ All traffic through microservices
- **MONOLITH_FALLBACK_ENABLED=false** ✅ No fallback for unmapped routes
- **DUAL_WRITE_ENABLED=true** ✅ Multiple DB writes for safety
- **All major cutover flags ENABLED** ✅

### Running Services (18 active)
Gateway, Identity, Candidate, Job, Matching-Decision, Analytics, Chat, Resume, Recruiting, Candidate-Core, Career Intelligence, Matching-Evaluation, Matching-Reasoning, BGE Shadow, Dynamic Weighting, JD Parser, JD-NLP, Monitoring

### Database Ownership
- tejoma_recruiting (monolith primary)
- tejoma_identity, tejoma_candidate, tejoma_chat, tejoma_recruiting_service, tejoma_matching_evaluation, tejoma_matching_reasoning, tejoma_platform_governance, tejoma_tenant_directory

### Known Cutover Patterns
Services use FLAG-BASED cutover to proxy to monolith when flag is disabled:
- CANDIDATE_ANALYTICS_CUTOVER_ENABLED (in candidate-service)
- RECRUITER_REVIEW_LIST_CUTOVER_ENABLED  
- EXPLANATION_GENERATION_CUTOVER_ENABLED
- RAG_INDEXING_CUTOVER_ENABLED
- ... others

---

## Execution Strategy

### Phase 1: Verify Current State
1. Check .env.local for ALL cutover flags
2. Verify which services have fallback-to-monolith logic
3. Identify TRUE runtime dependencies (not code comments)
4. Test each critical workflow with monolith OFF to measure actual impact

### Phase 2: Candidate-Decisions Completion (Partial - Phases 4-12)
- All code complete (from previous context)
- Execute remaining phases (4-12) for runtime validation
- Prove candidate-decisions works independently

### Phase 3-8: Systematic Domain Migration
For each domain:
1. **Identify current owner** (where does it live now?)
2. **Understand dependencies** (what does it need from monolith?)
3. **Create/verify service implementation** (local database + API)
4. **Backfill data** (migrate historical records)
5. **Enable cutover flag** (switch to local implementation)
6. **Test with monolith** (verify behavior matches)
7. **Test without monolith** (verify independence)
8. **Validate** (check for remaining monolithClient references)

### Phase 9: Monolith-Off System Test
- Stop monolith completely
- Run complete candidate journey (login → search → apply → review)
- Run complete recruiter journey (login → JD → search → swipe → review)
- Verify all platform functions (auth, RBAC, tenant isolation, notifications, chat, analytics, etc.)
- Document any failures and fix them

### Phase 10: Final Hardening
- Remove DUAL_WRITE_ENABLED when safe
- Clean up monolith proxy code (once dependencies verified)
- Final security audit (auth, RBAC, tenant isolation)
- Final performance audit
- Final monitoring audit

---

## Exact Domains to Migrate (In Order)

1. ✅ **candidate-decisions** - Partially done, finish phases 4-12
2. **candidate-applications** - Applications created/updated/deleted by candidates
3. **candidate-matches** - Matching status for candidates
4. **candidate-jobs** - Candidate job lists/details
5. **candidate-analytics** - Analytics (mostly local, verify all paths)
6. **candidate-search-shortlist** - Shortlist integration
7. **recruiter-review** - Recruiter review list and detail
8. **recruiter-matches** - Recruiter match queue/scoring
9. **swipes** - Recruiter swipe recording
10. **jobs** - Job create/update/delete
11. **chat** - Chat messages
12. **notifications** - All notification types
13. **all other routes** - Verify no remaining monolith dependencies

---

## Testing Strategy

### Monolith RUNNING Tests
- All endpoints work
- Data is being written to both DBs (dual-write)
- Responses match pre-migration behavior
- No 502 errors

### Monolith STOPPED Tests
- All endpoints still work
- Data writes to service DB only
- Same request/response contracts
- No 502 "service unavailable" errors
- No timeouts or connection errors

### Data Integrity Tests
- Record counts match between old and new DB
- Sample records have identical data
- Tenant/company isolation verified
- Timestamps and sequences correct
- No data loss or corruption

---

## Success Criteria

✅ **Production Ready When:**
1. MONOLITH_FALLBACK_ENABLED=false works for 100% of traffic
2. ALL critical workflows pass with monolith STOPPED
3. Data migration complete (record counts match)
4. Auth/RBAC/tenant isolation verified globally
5. NO business-critical code depends on monolith
6. All service-to-service calls work without monolith
7. No 502 errors or timeouts in logs
8. Monitoring/observability complete
9. Backup/restore tested

**Not Production Ready If:**
- Any critical workflow fails with monolith stopped
- Any data inconsistency found
- Auth/RBAC compromised
- Monolith still required for business logic
- Services have circular dependencies

---

## Next Immediate Actions

**EXECUTING NOW (No approval required):**
1. Verify all cutover flag states in .env.local
2. Complete candidate-decisions phases 4-12 (runtime testing)
3. Identify next domain (most likely candidate-applications)
4. Migrate next domain systematically
5. Continue until complete system works with monolith OFF
6. Generate final production readiness report

**Timeline:** Continuous execution, no stopping between domains

---

## Rollback Capability

At every step, if tests fail:
1. Disable the cutover flag for that domain
2. Services automatically proxy to monolith fallback
3. Zero impact on users
4. Safe to investigate and fix

**CRITICAL:** Do not delete monolith code until final validation complete.

