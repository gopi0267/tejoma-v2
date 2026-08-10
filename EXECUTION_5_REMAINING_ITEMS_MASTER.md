# Execution Master Plan: 5 Remaining Monolith Items

**Date**: 2026-08-07  
**Scope**: Complete all 5 monolith proxy routes → real service implementations  
**Total Effort**: ~40 hours over 2 weeks  
**Go-Live**: Production canary week of Aug 28  

---

## Item Dependency Graph

```
Item 1: GET /api/jobs (list)
  └─ Depends: job-service ✅, matching-decision-service ✅, candidate-core-service ✅
  └─ Status: READY FOR TESTING

Item 2: GET /api/candidate-search → tab/shortlisted
  ├─ Depends: Item 1 (uses latest-per-pair endpoint)
  ├─ Depends: candidate-service ✅, matching-decision-service ✅, candidate-core-service ✅
  └─ Status: DESIGN COMPLETE

Item 3: GET /api/recruiter-review/:id (detail)
  ├─ Depends: Item 1-2 (uses matching-decision-service)
  ├─ Depends: matching-decision-service ✅, monolith (explainability data)
  └─ Status: DESIGN COMPLETE

Item 4: GET /api/candidate-analytics
  ├─ Depends: Item 2 (uses cross-service clients)
  ├─ Depends: New dual-write mirror + cross-service reads
  └─ Status: DESIGN COMPLETE (requires new tables)

Item 5: GET /api/recruiter-review (list) - CQRS
  ├─ Depends: Item 4 (testing cross-service hooks)
  ├─ Depends: New materialized view + refresh hooks on 3 services
  └─ Status: DESIGN COMPLETE (highest complexity)
```

## Execution Timeline (14 days)

### Phase A: Items 1 + 3 (Parallel, 6 days)
No dependencies between them - can run in true parallel

#### Track A1: Item 1 (job list)
- **Day 1-2**: Configuration ✅ + Unit Tests
- **Day 3**: Integration Tests + A/B Parity
- **Day 4**: Staging Sign-Off + Docs

#### Track A2: Item 3 (recruiter-review detail)
- **Day 1-2**: Service Client (monolith calls) + Explainability Port
- **Day 3**: Integration Tests + A/B Parity
- **Day 4**: Staging Sign-Off + Docs

**End of Phase A**: Both items ready for canary, monolith proxy still active

---

### Phase B: Item 2 (3 days)
Depends on Item 1's internal endpoints, but otherwise independent

- **Day 5**: Service Clients (candidate-core, matching-decision, job-service)
- **Day 6**: Handler + Tests
- **Day 7**: A/B Parity + Sign-Off

**End of Phase B**: 3 items ready, all staging validated

---

### Phase C: Item 4 (4 days)
Depends on Item 2's service clients being stable

- **Day 8**: Schema + Migrations (new dual-write tables)
- **Day 9**: Dual-write hooks in 3 services
- **Day 10**: Backfill script + Validation
- **Day 11**: A/B Parity + Sign-Off

**End of Phase C**: 4 items ready, dual-write running (new tables syncing)

---

### Phase D: Item 5 (4 days)
Depends on Item 4's hooks being stable + all other items passing validation

- **Day 12**: CQRS view schema + backfill (existing infrastructure)
- **Day 13**: Refresh hooks + consumers
- **Day 14**: Full A/B validation + Sign-Off

**End of Phase D**: All 5 items ready for production canary

---

## Parallel Execution Strategy

### Team: 2 pairs (4 engineers)

**Pair 1** (Days 1-4): Item 1 + Item 3  
- Engineer A: Item 1 tests + integration  
- Engineer B: Item 3 explainability port + tests  
- Sync daily on cross-service validation

**Pair 2** (Days 1-7): Item 2 setup + Item 4 prep  
- Engineer C: Item 2 service clients + handler  
- Engineer D: Item 4 schema + migrations  
- Pair 2 reviews Pair 1's work daily (cross-validation)

**Days 8-14**: All hands on Items 4 + 5  
- Two pairs merge for complex CQRS coordination  
- One pair does final testing + documentation  

---

## Item 1 Status: GET /api/jobs (list)

**Status**: ✅ FOUNDATION COMPLETE  

### Done
- [x] Internal endpoints in matching-decision-service + candidate-core-service
- [x] Service clients (getSwipeCountsByJob, getCandidateCount)
- [x] Handler implementation (job-service/routes/jobs.routes.ts)
- [x] Feature flag (JOB_LIST_CUTOVER_ENABLED)
- [x] Environment variables exported

### Remaining (2 days)
- [ ] Unit tests (job-service/tests/routes/jobs.getJobsList.test.ts)
- [ ] Integration tests (docker compose + API gateway)
- [ ] A/B parity (20 companies, deep-equal responses)
- [ ] Staging sign-off + docs

### Success Criteria
- ✅ Response shape matches monolith exactly
- ✅ Swipe counts correct (total, accepted, rejected, pending)
- ✅ Acceptance rate formula correct
- ✅ Graceful degradation if services slow
- ✅ Feature flag OFF = monolith proxy (safety)

---

## Item 2: GET /api/candidate-search → tab/shortlisted

**Status**: ✅ DESIGN COMPLETE, READY FOR IMPLEMENTATION

### Architecture
```
GET /api/candidate-search/shortlisted?companyId=:companyId
  ├─ Call matching-decision-service: GET /internal/swipes/latest-per-pair?companyId=&action=1
  ├─ Filter: action=1 (accepted only)
  ├─ Extract: candidate_ids from swipes
  ├─ Call candidate-core-service: GET /internal/candidates/by-ids?ids=:ids
  ├─ Merge: swipe data + candidate details
  └─ Transform: toSearchResultShape (existing function)
```

### Endpoints Needed
- ✅ matching-decision-service: `GET /internal/swipes/latest-per-pair` (already exists)
- ✅ candidate-core-service: `GET /internal/candidates/by-ids` (already exists)
- ❌ candidate-service: Extend existing handler to call both services

### Effort: 6 hours
- Service clients: 1 hour
- Handler: 2 hours
- Tests: 2 hours
- A/B parity: 1 hour

---

## Item 3: GET /api/recruiter-review/:candidateId/:jobId (detail)

**Status**: ✅ DESIGN COMPLETE, READY FOR IMPLEMENTATION

### Architecture
```
GET /api/recruiter-review/:candidateId/:jobId
  ├─ Local: Get swipe + notes from matching-decision-service DB
  ├─ Cross-service: Get candidate from candidate-core-service
  ├─ Cross-service: Get job from job-service
  ├─ Cross-service: Get recruiter name from identity-service
  ├─ Monolith: Get explainability data (career_trajectories, reasoning_conclusions)
  └─ Compute: Match explanation (pure code, no DB)
```

### Endpoints Needed
- ✅ matching-decision-service: Extend internal routes
- ✅ candidate-core-service: `GET /internal/candidates/by-ids` (already exists)
- ✅ job-service: `GET /internal/jobs/by-ids` (already exists)
- ❌ identity-service: `GET /internal/users/by-ids` (NEW)
- ❌ monolith: Two new internal endpoints (career-trajectory, reasoning-conclusions)

### Effort: 8 hours
- Port explainability code: 2 hours
- Service clients: 2 hours
- Handler: 2 hours
- Tests: 2 hours

---

## Item 4: GET /api/candidate-analytics

**Status**: ✅ DESIGN COMPLETE, NEEDS SCHEMA WORK

### Architecture
```
New dual-write mirror in candidate-service:
  ├─ candidate_decisions (mirror from monolith)
  ├─ candidate_application_status (mirror from monolith)
  └─ mutual_matches (mirror from monolith)

GET /api/candidate-analytics
  ├─ Local: candidate_accounts (already owned)
  ├─ Local: candidate_decisions (newly mirrored)
  ├─ Local: candidate_application_status (newly mirrored)
  ├─ Local: mutual_matches (newly mirrored)
  ├─ Cross: candidate-core-service for candidate details
  ├─ Cross: matching-decision-service for latest swipes
  ├─ Cross: job-service for job titles
  └─ Compute: Score analytics (pure code)
```

### Tables to Create (in candidate-service DB)
- `candidate_decisions` (mirror)
- `candidate_application_status` (mirror)
- `mutual_matches` (mirror)

### Dual-Write Hooks (in monolith)
- POST /api/candidate-decisions → fire-and-forget to candidate-service
- PATCH /api/candidate-decisions/:id → fire-and-forget
- DELETE /api/candidate-decisions/:id → fire-and-forget

### Effort: 10 hours
- Schema + migrations: 2 hours
- Dual-write hooks: 2 hours
- Backfill script: 2 hours
- Service clients: 1 hour
- Handler: 2 hours
- Tests: 1 hour

---

## Item 5: GET /api/recruiter-review (list) - CQRS

**Status**: ✅ DESIGN COMPLETE, HIGHEST COMPLEXITY

### Architecture
```
New CQRS materialized view in matching-decision-service:
  ├─ Table: recruiter_review_view
  │  ├─ Denormalized columns (50+):
  │  │  ├─ candidate: id, name, email, phone, skills, company, experience
  │  │  ├─ job: id, title, location, required_skills
  │  │  ├─ recruiter: id, name
  │  │  ├─ swipe: id, action, match_score, decision_date
  │  │  └─ note: latest_text, latest_at
  │  └─ Indexes: company_id+created_at, company_id+recruiter_id, company_id+job_id, GIN for search
  └─ Keyed by: (candidate_id, job_id) - upsert in place

Refresh hooks (fire-and-forget, non-fatal):
  ├─ candidate-core-service writes → POST /recruiter-review-view/refresh-candidate
  ├─ job-service writes → POST /recruiter-review-view/refresh-job
  ├─ identity-service writes → POST /recruiter-review-view/refresh-recruiter
  └─ matching-decision-service writes → call local upsertRecruiterReviewViewRow
```

### Operations
- GET /api/recruiter-review?company_id=&job_id=&recruiter_id=&action=&search=&page=&limit=
- Queries local view table
- Supports full-text search (GIN index on skills/names)
- 100% parity with monolith's 5-table join

### Effort: 14 hours
- Schema + view + indexes: 2 hours
- Backfill script: 2 hours
- Refresh hooks (3 services): 3 hours
- Handler: 2 hours
- Tests: 3 hours
- A/B validation: 2 hours

---

## Testing Strategy (Per Item)

### Unit Tests
- Mock all service clients
- Verify response shape
- Verify field types
- Test edge cases (no data, slow services, errors)

### Integration Tests
- Docker Compose: All dependent services running
- Call via API Gateway (full request path)
- Verify monolith proxy still works (flag OFF)
- Verify service call works (flag ON)

### A/B Parity Tests
- Staging environment with real data
- Call both endpoints (monolith vs service)
- Deep-equal JSON comparison
- Run 20+ random IDs per endpoint
- Verify no field drift, no ordering issues
- Pass criteria: 100% parity across all tests

### Performance Baseline
- P99 latency target (service should match/beat monolith)
- Error rate < 0.01%
- No connection leaks
- Memory stable under 50 req/s for 1 hour

---

## Feature Flags (All Items)

| Item | Flag Name | Default | Purpose |
|------|-----------|---------|---------|
| 1 | `JOB_LIST_CUTOVER_ENABLED` | false | Flip from monolith proxy to service |
| 2 | `CANDIDATE_SEARCH_CUTOVER_ENABLED` | false | Flip from monolith proxy to service |
| 3 | `RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED` | false | Flip from monolith proxy to service |
| 4 | `CANDIDATE_ANALYTICS_CUTOVER_ENABLED` | false | Flip from monolith proxy to service |
| 5 | `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED` | false | Flip from monolith proxy to CQRS view |

All flags:
- Default OFF (safe, monolith is source-of-truth)
- Toggled independently (can roll back 1 item without affecting others)
- Read on every request (no caching, instant effect)
- Exposed in Prometheus metrics

---

## Production Rollout (Week of Aug 28)

### Stage 1: Staging (Aug 28)
- [ ] Deploy all 5 items to staging (flags OFF)
- [ ] Run full test suite (unit + integration + parity)
- [ ] Verify dual-writes working (Item 4 + Item 5)
- [ ] Get sign-offs (QA + Ops + Tech Lead)

### Stage 2: Canary 10% (Aug 31 - Sep 2)
- [ ] Enable Item 1 flag for 10% of requests
- [ ] Monitor error rate (< 0.01%), latency (< 500ms)
- [ ] After 48 hours stable: Proceed to 50%

### Stage 3: Canary 50% (Sep 3 - Sep 10)
- [ ] Enable Item 2 flag for 50% of requests
- [ ] Monitor for 7 days
- [ ] Validate Item 1 still stable at 10%
- [ ] After 7 days: Proceed to Item 3

### Stage 4: Canary 100% (Sep 11 - Sep 24)
- [ ] Roll out Items 3, 4, 5 in sequence
- [ ] Item 3: 48 hours 10% → 50% → 100%
- [ ] Item 4: 72 hours (dual-write migration, validate mirror sync)
- [ ] Item 5: 5 days (CQRS view must be 100% sync before cutover)

### Stage 5: GA (Sep 25 - Sep 29)
- [ ] All 5 flags enabled (100% traffic on services)
- [ ] Decommission monolith proxy routes
- [ ] Remove feature flag code
- [ ] Monolith becomes read-only reference (backup)

---

## Success Metrics (Per Item)

| Item | Metric | Target | Method |
|------|--------|--------|--------|
| All | Error Rate | < 0.01% | Prometheus |
| All | P99 Latency | < 1000ms | Grafana |
| All | Parity Drift | 0 mismatch | A/B tests |
| 4 | Dual-Write Lag | < 5s | Sync monitor |
| 5 | View Sync | 100% | Refresh hooks |
| 5 | Search Accuracy | ✓ (parity) | Query tests |

---

## Rollback Strategy

### Per-Item Rollback (< 1 minute)
```bash
# Edit env variable
ITEM_1_CUTOVER_ENABLED=false

# Restart service
kubectl rollout restart deployment/job-service

# Traffic reverts to monolith proxy
# Verify: curl /api/jobs (should proxy to monolith)
```

### Full Rollback (if needed)
- All flags to OFF
- Restart affected services
- Monolith continues handling 100% traffic
- Zero data loss (dual-writes always kept monolith in sync)

---

## Documentation Checklist

- [ ] Item 1: Implementation guide + test cases
- [ ] Item 2: Implementation guide + test cases
- [ ] Item 3: Implementation guide + test cases (explainability port)
- [ ] Item 4: Schema guide + dual-write hook guide + backfill procedure
- [ ] Item 5: CQRS design + refresh hook procedures + monitoring guide
- [ ] Runbook: Step-by-step canary deployment
- [ ] Monitoring: Alert rules + dashboards
- [ ] Communications: Status page updates + Slack notifications

---

## Team Sign-Offs

### Daily Sync (9 AM)
- Pair 1 demos work from previous day
- Pair 2 presents blockers
- Decide on parallel work for the day

### Staging Sign-Off (Day 4 End)
- [ ] Tech Lead: Code review + architecture sign-off
- [ ] QA Lead: All tests passing + parity validated
- [ ] Ops Lead: Monitoring + alerting ready
- [ ] Product: Status page ready

### Canary Sign-Off (Weekly)
- [ ] Ops: Canary deployment successful
- [ ] On-Call: No alerts, no issues
- [ ] Tech Lead: Approve proceeding to next stage

### GA Sign-Off (Week of Sep 25)
- [ ] All 5 items stable at 100% canary
- [ ] Proxy routes decommissioned
- [ ] Feature flags removed
- [ ] Production ready

---

## Next Immediate Actions

**Today (Aug 7)**:
1. Review this master plan
2. Assign Pair 1 + Pair 2
3. Set up daily sync meetings
4. Kick off Item 1 unit tests + Item 3 explainability port

**Tomorrow (Aug 8)**:
1. Item 1 integration tests running
2. Item 3 service clients implemented
3. Item 2 design finalized
4. Item 4 schema review

**Day 3 (Aug 9)**:
1. Item 1 staging validation
2. Item 3 tests passing
3. Item 2 handler + tests
4. Item 4 migrations ready

**Day 4 (Aug 10)**:
1. Item 1 + 3 production ready
2. Item 2 A/B parity passing
3. Item 4 backfill scripts written

---

**Prepared by**: Migration Team  
**Date**: 2026-08-07  
**Status**: READY FOR EXECUTION  
**Confidence**: HIGH  
**Go-Live Target**: September 29, 2026  

**Let's complete this migration! 🚀**
