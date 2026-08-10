# Phase 5: Testing & Production Rollout

**Duration**: Sept 1-30, 2026
**Goal**: Validate all 5 Phase 4 items match monolith behavior, then roll out gradually to production
**Risk Level**: LOW (feature flags allow instant rollback)

---

## Testing Strategy

### 1. A/B Parity Tests (Sept 1-10)

**Goal**: Verify new service implementations return identical results to monolith

**Test Format**:
- Seeded dataset: 100 candidates, 50 jobs, 2000 swipes, recruiter decisions
- For each endpoint: call both old (monolith proxy) and new (service implementation)
- Deep-equal the JSON responses (ignore timestamps ±5s)
- Assert zero parity violations

#### Item 1: GET /api/jobs (list)
```
Test: GET /api/jobs?page=1&limit=50
Compare:
  - monolith proxy response
  - job-service local implementation
Verify:
  - Same job_id array (same order by created_at DESC)
  - Same swipe_count per job (matches matching-decision-service)
  - Same candidate_pool_count per job (matches candidate-core-service)
```

#### Item 2: GET /candidate-search/tab/shortlisted
```
Test: GET /candidate-search/tab/shortlisted?page=1&limit=50
Compare:
  - monolith proxy response
  - candidate-service local implementation
Verify:
  - Same candidate_id array (same order)
  - Same matched_jobs_count per candidate
  - Same latest_match_date per candidate
```

#### Item 3: GET /api/recruiter-review/:candidateId/:jobId (detail)
```
Test: GET /api/recruiter-review/1/1 (real candidate-job pair from seeded data)
Compare:
  - monolith proxy response
  - matching-decision-service local implementation
Verify:
  - Same candidate/job/recruiter names
  - Same swipe score ±0.1 (float precision)
  - Same explanation narrative (exact string match)
  - Same recommendations array (same order, same skill names)
```

#### Item 4: GET /api/candidate-analytics
```
Test: GET /api/candidate-analytics (for seeded candidate)
Compare:
  - monolith proxy response
  - candidate-service local implementation
Verify:
  - Same averageMatchScore ±1 (rounding)
  - Same recruiterResponseRate (same calculation logic)
  - Same funnel counts (same queries)
  - Same topSkills array (same intersection logic)
  - Same interviewProbability (same heuristic blend)
```

#### Item 5: GET /api/recruiter-review (list)
```
Test: GET /api/recruiter-review?page=1&pageSize=25 (with various filters)
Compare:
  - monolith proxy response
  - matching-decision-service view query
Verify:
  - Same row count (pagination)
  - Same candidate_id/job_id pairs (same order)
  - Same recruiter_note text
  - Same decision_date values
  - Total count matches
```

**Test Script**: `scripts/run-ab-parity-tests.ts`
- Reads seeded fixtures (candidates, jobs, swipes, decisions)
- Calls both old and new endpoints in parallel
- Deep-equals responses
- Logs first diff on failure (helps debug)
- Non-zero exit if any parity violation found

**Success Criteria**:
- Zero parity violations across all 5 endpoints
- 100 test cases per endpoint (different filters/sorts)
- All tests complete in < 5 minutes

---

### 2. Integration Tests (Sept 1-10)

**Goal**: Verify full request path (nginx → api-gateway → service → DB)

**Test Type 1: Write Path Mirrors**
```
Test: POST /api/swipes (write new swipe)
Verify:
  1. Swipe written to matching-decision-service DB
  2. Dual-write hook fires to monolith (check monolith DB for mirror row)
  3. GET swipe back, verify matches what was written
  4. No errors in logs (check stderr output)
```

**Test Type 2: Read Path Cutover**
```
Test: GET /api/jobs with feature flag true
Verify:
  1. Request routes to job-service (not monolith)
  2. Response is fast (< 100ms)
  3. Response matches monolith (parity test)
  4. nginx log shows job-service:4018 as backend
```

**Test Type 3: Feature Flag Instant Rollback**
```
Test: GET /api/recruiter-review with flag false → true → false
Verify:
  1. With flag=false: response from monolith, slower (200-500ms)
  2. Flip flag to true: response from view, fast (50-100ms)
  3. Flip flag back to false: response from monolith again, same data
  4. No errors in any state
```

**Test Script**: `scripts/run-integration-tests.ts`
- Uses docker-compose to start all services
- Inserts seeded test data
- Runs write + read paths
- Checks logs for errors
- Measures latencies

**Success Criteria**:
- All paths complete without errors
- Read latencies: < 100ms (service), < 500ms (monolith proxy)
- Dual-writes succeed on 99%+ of requests
- Feature flag toggle works instantly

---

### 3. Load Tests (Sept 5-10)

**Goal**: Verify systems handle production load (1000 req/s per endpoint)

**Load Profile**:
- Ramp-up: 0 → 1000 req/s over 2 minutes
- Steady-state: 1000 req/s for 5 minutes
- Ramp-down: 1000 → 0 req/s over 1 minute
- Repeat for each of 5 endpoints

**Metrics to Monitor**:
- Response time: p50, p95, p99 (target: p99 < 200ms for list, < 100ms for detail)
- Error rate: target < 0.1%
- Database connection pool: max utilization < 80%
- CPU/memory: < 70% per service

**Load Test Tool**: k6 (Grafana's load testing tool)
- Script: `scripts/load-test-phase4-items.js`
- Results: Dashboard at localhost:3000 (Grafana)
- Output: CSV file with p50/p95/p99 latencies

**Success Criteria**:
- p99 latency < 200ms for list endpoints
- p99 latency < 100ms for detail endpoints
- Error rate < 0.1%
- No connection pool exhaustion
- Services stable after 5 minutes under load

---

## Gradual Production Rollout (Sept 15-30)

### Phase 5a: Canary (Sept 15-17)

**Configuration**:
- Feature flag: enabled (true)
- Traffic: 10% to service, 90% to monolith (via api-gateway weights)
- Monitoring: every 5 minutes

**Rollback Condition** (immediate):
- Error rate spike > 1%
- p99 latency > 1000ms
- Parity drift detected (validation scripts)

**Validation** (every 12 hours):
- Run validation scripts (backfill-verify for Items 1-4, view-verify for Item 5)
- Compare service responses vs. monolith (parity test)
- Check logs for warnings/errors

**Success Criteria**:
- No errors in 48 hours
- Error rate < 0.01%
- Latencies stable

---

### Phase 5b: Beta (Sept 18-24)

**Configuration**:
- Feature flag: enabled (true)
- Traffic: 50% to service, 50% to monolith
- Monitoring: every 5 minutes

**Rollback Condition** (immediate):
- Error rate spike > 0.5%
- p99 latency > 500ms
- Parity drift detected

**Validation** (daily):
- Run all validation scripts
- Deep compare random samples (100 rows per service)
- Check database sizes (view size growing correctly?)

**Success Criteria**:
- No rollbacks triggered
- Error rate < 0.05%
- Latencies stable under 50% load

---

### Phase 5c: General Availability (Sept 25-30)

**Configuration**:
- Feature flag: enabled (true)
- Traffic: 100% to service (0% to monolith)
- Monitoring: continuous

**Rollback Condition** (immediate):
- Error rate spike > 0.1%
- p99 latency > 300ms

**Validation** (every 6 hours):
- Continuous validation (automated cron jobs)
- Alert if drift detected
- Alert if latency SLO breached

**Success Criteria**:
- Stable for 5 days under full production load
- Error rate < 0.05%
- Latencies p99 < 200ms

---

## Monitoring Setup

### Metrics Dashboard (Grafana)

**Per Endpoint**:
- Request rate (req/s)
- Latency: p50, p95, p99
- Error rate (%)
- Status code distribution

**Per Service**:
- CPU usage (%)
- Memory usage (MB)
- Database connections (active/total)
- Disk I/O (MB/s)

**Data Quality**:
- Dual-write success rate (%)
- View row count (vs. monolith swipes)
- Parity check status (automated)

### Alerts

**Critical** (page on-call):
- Error rate > 1% for 5 minutes
- p99 latency > 1000ms for 10 minutes
- Database connection pool exhausted

**Warning** (Slack):
- Error rate > 0.1% for 10 minutes
- p99 latency > 500ms for 10 minutes
- Dual-write success rate < 99%
- View drift detected (> 10 row diff)

### Logging

**Structured Logs** (JSON, indexed):
```json
{
  "timestamp": "2026-09-15T10:30:45Z",
  "level": "info",
  "service": "job-service",
  "endpoint": "GET /api/jobs",
  "company_id": 123,
  "latency_ms": 45,
  "status": 200,
  "trace_id": "abc-123-def",
  "feature_flag": "JOB_LIST_CUTOVER_ENABLED=true"
}
```

**Query Examples**:
- "Find all errors for GET /api/recruiter-review in last hour"
- "Get p99 latency for GET /api/jobs over last 24 hours"
- "Find requests with latency > 1000ms"

---

## Validation Scripts (Run Continuously)

### Before Each Rollout Stage

**Script 1: Backfill Verify** (Items 1-4)
```bash
# Runs every 6 hours, or on-demand before rollout
npx ts-node scripts/validate-candidate-analytics-sync.ts
# Checks: candidate_decisions, candidate_application_status, mutual_matches row counts
# Exits 0 if all match, 1 if drift > 10 rows
```

**Script 2: View Verify** (Item 5)
```bash
# Runs every 6 hours, or on-demand before rollout
npx ts-node scripts/validate-recruiter-review-view-sync.ts
# Checks: recruiter_review_view row count vs. monolith swipes
# Exits 0 if match, 1 if drift > 10 rows
```

**Script 3: Parity Check** (All endpoints)
```bash
# Runs before each rollout stage (manually)
npx ts-node scripts/run-ab-parity-tests.ts
# Compares service responses vs. monolith
# Reports first 10 diffs if found
```

---

## Checklist Before Production (Sept 30)

### Code
- [ ] All 5 items implemented and feature-flagged
- [ ] All tests pass (A/B parity, integration, load)
- [ ] Code review approved (staging, security, performance)
- [ ] No console.log() or debug code left

### Configuration
- [ ] Feature flags documented in runbook
- [ ] Rollback procedure documented and tested
- [ ] Monitoring dashboards created
- [ ] Alerts configured

### Data
- [ ] Backfill scripts run successfully (zero drift)
- [ ] Validation scripts pass (zero drift)
- [ ] Production databases sized correctly

### Operations
- [ ] On-call engineer trained on rollback
- [ ] Incident response playbook written
- [ ] Communication plan (status updates during rollout)

---

## Rollback Procedures

### Instant Rollback (< 1 minute)

**If error rate spikes during canary/beta/GA**:
1. Flip feature flag to false (e.g., `JOB_LIST_CUTOVER_ENABLED=false`)
2. Restart api-gateway pod (picks up new config)
3. Verify traffic flows to monolith (check logs)
4. Monitor error rate return to normal (should be < 1 minute)

**Example**:
```bash
# 1. Update .env (or config management system)
JOB_LIST_CUTOVER_ENABLED=false

# 2. Restart api-gateway
kubectl rollout restart deployment/api-gateway

# 3. Verify
kubectl logs -f deployment/api-gateway | grep "traffic routing"

# 4. Check error rate in Grafana (should drop within 60s)
```

### Data Rollback (if drift detected)

**If validation script detects drift (rows missing/mismatched)**:
1. Stop dual-write hooks (set `DUAL_WRITE_ENABLED=false` in monolith)
2. Re-run backfill script from clean state
3. Re-run validation script
4. Resume dual-write hooks

**Example**:
```bash
# 1. Stop dual-writes
kubectl set env deployment/monolith DUAL_WRITE_ENABLED=false

# 2. Backfill from scratch
npx ts-node scripts/backfill-candidate-analytics.ts

# 3. Validate
npx ts-node scripts/validate-candidate-analytics-sync.ts
# Should exit 0 (all match)

# 4. Resume dual-writes
kubectl set env deployment/monolith DUAL_WRITE_ENABLED=true
```

---

## Success Criteria (Phase 5)

✅ **Testing** (Sept 1-10)
- A/B parity tests: 100% pass
- Integration tests: 100% pass
- Load tests: p99 < 200ms, error rate < 0.1%

✅ **Canary** (Sept 15-17)
- 48 hours with 10% traffic, zero errors
- Validation scripts: zero drift

✅ **Beta** (Sept 18-24)
- 7 days with 50% traffic, zero errors
- Latencies stable (no regression)

✅ **GA** (Sept 25-30)
- 5 days with 100% traffic, zero errors
- Error rate < 0.05%
- p99 latency < 200ms

---

## Timeline

```
Sept 1-10:  Testing (A/B parity, integration, load)
Sept 15-17: Canary (10% traffic)
Sept 18-24: Beta (50% traffic)
Sept 25-30: GA (100% traffic)
Oct 1+:     Monitor, optimize, close Phase 5
```

---

## What's Next After Phase 5

### Oct 1-31: Optimization Phase
- [ ] Database query optimization (slow log analysis)
- [ ] Connection pool tuning
- [ ] Cache layer (Redis for frequently queried data)
- [ ] Archival strategy (old swipes → cold storage)

### Nov 1+: Feature Work
- [ ] New matching algorithms on top of stable microservices foundation
- [ ] Real-time notifications (WebSocket layer)
- [ ] Advanced analytics (data warehouse integration)

---

**Status**: Ready for Phase 5 testing
**Dependencies**: All Phase 4 items complete and feature-flagged
**Risk Level**: LOW (instant rollback via flags)
