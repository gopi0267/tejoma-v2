# Phase E: Monolith Internal Endpoints Audit

## Currently Mounted Endpoints (server.ts)

All 11 internal routes are mounted in server.ts:
1. ✅ /internal/candidate
2. ✅ /internal/candidate-core
3. ✅ /internal/candidate-search
4. ✅ /internal/chat
5. ✅ /internal/job
6. ✅ /internal/matching-decision
7. ✅ /internal/matching-evaluation
8. ✅ /internal/matching-scoring
9. ✅ /internal/rag (new - Phase D Item 8)
10. ✅ /internal/resume
11. ✅ /internal/skill-discovery

## Service Call Audit

Services are making calls to these monolith endpoints:
- ✅ /internal/candidate - called
- ✅ /internal/candidate-core - called
- ✅ /internal/candidate-search/shortlisted - called
- ✅ /internal/chat - called
- ✅ /internal/job - called
- ✅ /internal/matching-decision - called
- ✅ /internal/matching-evaluation - called
- ✅ /internal/matching-scoring - called
- ✅ /internal/skill-discovery - called
- ✅ /internal/resume - called
- ⚠️ /internal/rag - defined but not yet called (RAG_INDEXING_CUTOVER_ENABLED=false)

## Dead Code Identified

Services attempting to call endpoints that NO LONGER EXIST:
- ❌ /internal/analytics (analytics-service fully migrated)
- ❌ /internal/recruiting (recruiting-service fully migrated)
- ❌ /internal/notifications/create (notifications-service fully migrated)
- ❌ /internal/uploads/create (upload-service fully migrated)

These are in monolithClient.ts files but the monolith no longer serves them - likely from Phase A/B migrations that already completed.

## Endpoint Necessity Assessment

### Likely Still Needed (called by services)
- candidate, candidate-core, job, chat, resume, skill-discovery, matching-decision, matching-evaluation, matching-scoring
- candidate-search (shortlist endpoint in use)

### Auditing Required
- Which specific endpoints within each route are actually used?
- Can any be removed as services transition to full ownership?

## Next Steps for Phase E

1. ✅ Identify dead endpoints (DONE - found 4 services calling non-existent endpoints)
2. ⏳ Verify each remaining endpoint's actual usage
3. ⏳ Remove endpoints that are truly dead (fallback only, no real calls)
4. ⏳ Document what's left for Phase F decommission

## Safety Notes

- All 11 routes are currently active (if we remove them, services will fail)
- No endpoints should be removed until verified as unused
- Services have fallback logic but that should only activate on failure
- Gateway routes to services first, then falls back to monolith
