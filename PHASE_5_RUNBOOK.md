# Phase 5 Production Rollout Runbook

**Document Version**: 1.0
**Last Updated**: Aug 6, 2026
**Owner**: Platform Engineering
**Status**: Ready for Phase 5 execution (Sept 1, 2026)

---

## Overview

This runbook covers the production rollout of Phase 4 (5 monolith extraction items) across three stages:
1. **Canary** (Sept 15-17): 10% traffic
2. **Beta** (Sept 18-24): 50% traffic
3. **General Availability** (Sept 25-30): 100% traffic

All rollouts use feature flags for instant rollback. No data migration, no downtime.

---

## Prerequisites

### Before Sept 1

- [ ] Phase 4 code deployed to staging
- [ ] A/B parity tests passing (100%)
- [ ] Integration tests passing (100%)
- [ ] Load tests passing (p99 < 200ms, error < 0.1%)
- [ ] Monitoring dashboards created (Grafana)
- [ ] Alerts configured (PagerDuty)
- [ ] On-call engineer trained
- [ ] Rollback procedure tested in staging

### Configuration Ready

- [ ] Feature flags in environment (default false):
  - `JOB_LIST_CUTOVER_ENABLED=false`
  - `SHORTLIST_SEARCH_CUTOVER_ENABLED=false`
  - `RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED=false`
  - `CANDIDATE_ANALYTICS_CUTOVER_ENABLED=false`
  - `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=false`
- [ ] DUAL_WRITE_ENABLED=true in monolith (all tables mirrored)
- [ ] Validation scripts deployed and tested

### Data Ready

- [ ] Backfill scripts completed zero drift
- [ ] Validation scripts show 100% sync
- [ ] All dual-write hooks verified working

---

## Canary Deployment (Sept 15-17)

### Step 1: Enable Feature Flags (10% Traffic)

**Option A: Using Kubernetes**
```bash
# Get current pod
kubectl get pods -l app=api-gateway

# Set feature flag environment variable
kubectl set env deployment/api-gateway \
  JOB_LIST_CUTOVER_ENABLED=true \
  SHORTLIST_SEARCH_CUTOVER_ENABLED=true \
  RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED=true \
  CANDIDATE_ANALYTICS_CUTOVER_ENABLED=true \
  RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=true

# Restart to pick up changes
kubectl rollout restart deployment/api-gateway

# Wait for rollout
kubectl rollout status deployment/api-gateway
```

**Option B: Using Config Management (Consul/Vault/etcd)**
```bash
# Write flags to config system
consul kv put tejoma/phase5/flags/enabled true

# Restart api-gateway
ansible-playbook -i inventory playbooks/restart-api-gateway.yml
```

**Option C: Using Environment Files**
```bash
# SSH to api-gateway node
ssh deploy@api-gateway-prod-1

# Edit .env file
vim /opt/tejoma/api-gateway/.env
# Change: *_CUTOVER_ENABLED=true

# Restart service
sudo systemctl restart api-gateway
sudo systemctl status api-gateway

# Verify
curl http://localhost:3000/health
```

### Step 2: Set Traffic Weight (10% to service)

**Using nginx upstream weights** (if using nginx as reverse proxy):
```nginx
upstream monolith {
  server monolith-1:3006 weight=9;  # 90% to monolith
}

upstream job_service {
  server job-service:4018 weight=1; # 10% to service
}

# Route /api/jobs to service sometimes, monolith usually
location /api/jobs {
  if ($random < 0.1) {
    proxy_pass http://job_service;
  }
  proxy_pass http://monolith;
}
```

**Using HAProxy**:
```
backend api_gateway_canary
  balance roundrobin
  server monolith-1 monolith-1:3006 weight 9
  server job-service job-service:4018 weight 1
```

**Verify traffic routing**:
```bash
# Check api-gateway logs for routing
tail -f /var/log/api-gateway/access.log | grep "upstream: job-service"

# Should see ~10% of requests going to job-service
```

### Step 3: Monitor Canary (48 hours)

**Every 5 minutes** (automated):
```bash
# Monitor dashboard at:
# - Grafana: http://localhost:3000/d/phase5-canary
# - Prometheus: http://localhost:9090

# Check these metrics:
# - request_rate (req/s)
# - latency_p99 (should be < 200ms)
# - error_rate (should be < 0.01%)
# - status_code_distribution (5xx errors?)
```

**Every 12 hours** (manual):
```bash
# Run validation scripts
npx ts-node scripts/validate-candidate-analytics-sync.ts
# Expected: "✅ All tables in sync! Ready for cutover."

npx ts-node scripts/validate-recruiter-review-view-sync.ts
# Expected: "✅ All validations passed! Ready for cutover."

# Run parity tests on sample data
npx ts-node scripts/run-ab-parity-tests.ts
# Expected: "Results: 5/5 tests passed"
```

**Check logs for errors**:
```bash
# Job service
kubectl logs -f deployment/job-service | grep -i "error\|exception\|fail"

# Candidate service
kubectl logs -f deployment/candidate-service | grep -i "error\|exception\|fail"

# Matching decision service
kubectl logs -f deployment/matching-decision-service | grep -i "error\|exception\|fail"
```

### Step 4: Canary Success Criteria

**Must pass all of these before proceeding to Beta**:
- [ ] Zero errors in 48 hours (< 1 per 1M requests)
- [ ] Error rate < 0.01% (< 1 error per 10k requests)
- [ ] p99 latency < 200ms (consistent with load test)
- [ ] Validation scripts: zero drift detected
- [ ] Parity tests: 100% match
- [ ] No rollback needed

**If any criteria fails**:
- [ ] Immediately execute rollback (see Rollback section)
- [ ] Investigate error logs
- [ ] Fix code or data
- [ ] Wait 48 hours before retry

---

## Beta Deployment (Sept 18-24)

### Step 1: Increase Traffic to 50%

**Update nginx weights**:
```nginx
upstream monolith {
  server monolith-1:3006 weight=5;  # 50% to monolith
}

upstream microservices {
  server job-service:4018 weight=1;                         # 10%
  server candidate-service:4005 weight=1;                   # 10%
  server matching-decision-service:4020 weight=1;           # 10%
  server candidate-core-service:4019 weight=1;              # 10%
  server identity-service:4001 weight=1;                    # 10%
}

# 50% to services, 50% to monolith
location / {
  if ($random < 0.5) {
    proxy_pass http://microservices;
  }
  proxy_pass http://monolith;
}
```

### Step 2: Monitor Beta (7 days)

**Same monitoring as Canary** (every 5 minutes automated):
- Request rate
- Latency (p50, p95, p99)
- Error rate
- Dual-write success rate

**Daily validation** (manual):
```bash
# Run validation scripts
npx ts-node scripts/validate-candidate-analytics-sync.ts
npx ts-node scripts/validate-recruiter-review-view-sync.ts

# Deep compare 100 random rows from monolith vs. service
npx ts-node scripts/compare-sample-data.ts --samples=100

# Check database connection pool usage
kubectl get pods | grep -E "job-service|candidate-service" | xargs -I {} kubectl logs {} | grep "connection pool"
```

### Step 3: Beta Success Criteria

- [ ] Zero errors for 7 days (< 1 per 1M requests)
- [ ] Error rate < 0.05% (< 1 error per 20k requests)
- [ ] p99 latency stable (no degradation from canary)
- [ ] Validation scripts: zero drift daily
- [ ] No rollback needed
- [ ] Database performance: CPU < 70%, memory < 70%

**If any criteria fails**:
- [ ] Execute rollback immediately
- [ ] Investigate root cause
- [ ] Fix and re-test in staging
- [ ] Wait 1 week before retry

---

## General Availability (Sept 25-30)

### Step 1: Set Traffic to 100%

**All requests go to services (no fallback to monolith)**:
```nginx
upstream services {
  server job-service:4018;
  server candidate-service:4005;
  server matching-decision-service:4020;
  server candidate-core-service:4019;
}

location / {
  proxy_pass http://services;
}
```

### Step 2: Continuous Monitoring (5 days)

**Automated** (every 5 minutes):
- All metrics from Canary/Beta
- Drift detection (automated alerts)

**Manual checks** (twice daily):
```bash
# Morning check (9 AM)
npx ts-node scripts/validate-all-services.ts

# Evening check (5 PM)
npx ts-node scripts/run-ab-parity-tests.ts --sample-size=1000
```

**Alert thresholds** (immediate escalation):
- Error rate > 0.1% for 5 minutes
- p99 latency > 300ms for 10 minutes
- Drift detection (> 10 rows difference)

### Step 3: GA Success Criteria

- [ ] Stable for 5 days (zero unplanned rollbacks)
- [ ] Error rate < 0.05%
- [ ] p99 latency < 200ms consistently
- [ ] Validation scripts: zero drift daily
- [ ] Database performance optimal

**If GA stable for 5 days**:
- Phase 5 is complete ✅
- Declare Phase 4 migration **production-ready**
- Begin Phase 5 optimization work (Oct 1)

---

## Rollback Procedures

### Quick Rollback (< 1 minute)

**Triggered by**:
- Error rate > 1% for 5 minutes
- p99 latency > 1000ms for 10 minutes
- On-call engineer judgment

**Steps**:
```bash
# 1. Disable all feature flags
kubectl set env deployment/api-gateway \
  JOB_LIST_CUTOVER_ENABLED=false \
  SHORTLIST_SEARCH_CUTOVER_ENABLED=false \
  RECRUITER_REVIEW_DETAIL_CUTOVER_ENABLED=false \
  CANDIDATE_ANALYTICS_CUTOVER_ENABLED=false \
  RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=false

# 2. Restart api-gateway (picks up new env)
kubectl rollout restart deployment/api-gateway

# 3. Wait for rollout
kubectl rollout status deployment/api-gateway

# 4. Verify traffic now flows to monolith
tail -f /var/log/api-gateway/access.log | head -20
# Should see no service calls, all monolith

# 5. Monitor error rate recovery
# Should drop to pre-rollout levels within 60s
```

**Post-Rollback**:
1. Notify team (Slack: #platform-oncall)
2. Check monolith logs for errors (might have been overloaded)
3. Wait 1 hour for stability
4. Run parity tests to understand what went wrong
5. File incident report (template below)
6. Fix code/data before retry

### Data Rollback (if drift detected)

**Triggered by**:
- Validation script shows > 10 row difference
- Drift alert from continuous monitoring

**Steps**:
```bash
# 1. Stop dual-writes (prevent further divergence)
kubectl set env deployment/monolith DUAL_WRITE_ENABLED=false

# 2. Verify dual-writes stopped
kubectl logs deployment/monolith | grep "DUAL_WRITE_ENABLED=false"

# 3. Re-run backfill from scratch
npx ts-node scripts/backfill-candidate-analytics.ts
npx ts-node scripts/backfill-recruiter-review-view.ts

# 4. Validate zero drift
npx ts-node scripts/validate-candidate-analytics-sync.ts
npx ts-node scripts/validate-recruiter-review-view-sync.ts
# Both should exit 0

# 5. Resume dual-writes
kubectl set env deployment/monolith DUAL_WRITE_ENABLED=true

# 6. Verify sync continues
npx ts-node scripts/validate-all-services.ts
```

**Post-Data-Rollback**:
1. Run parity tests on full dataset
2. Verify no ongoing drift
3. Resume service traffic (if was not already rolled back)

---

## Incident Response

### If Rollback Triggered During Canary

**Template**:
```
Incident: Phase 5 Canary Rollback

Triggered: [timestamp]
Stage: Canary (10% traffic)
Reason: [error rate spike | latency spike | drift detected]

Timeline:
- [time]: Anomaly detected (e.g., error rate 1.5%)
- [time]: Rollback executed (flags disabled, api-gateway restarted)
- [time]: Traffic back to 100% monolith
- [time]: Error rate returned to normal (< 0.01%)

Investigation:
- [describe what went wrong in logs, data, or code]
- [root cause identified]

Remediation:
- [fix applied to code / data / config]
- [re-testing in staging]

Retry Date: [Sept 20 / Sept 22 / etc.]
```

**Send to**:
- Slack: #platform-incidents
- PagerDuty: incident record
- Post-mortem meeting: 24 hours after rollback

---

## Monitoring Dashboard

### Key Metrics to Watch

**Grafana Dashboard**: http://localhost:3000/d/phase5-status

Panels:
1. **Request Rate** (req/s): 4-6k req/s normal
2. **Error Rate** (%): Target < 0.05%
3. **Latency (p99)** (ms): Target < 200ms
4. **Status Codes**: 2xx should be > 99.9%
5. **Dual-Write Success** (%): Target > 99.5%
6. **Drift Detection** (rows): Target 0
7. **Database Connections**: Target < 80% of pool max
8. **CPU/Memory Usage**: Target < 70% per service

### Alerts (PagerDuty)

**Critical** (immediate escalation):
- Error rate > 1% for 5 minutes
- p99 latency > 1000ms for 10 minutes
- Drift detected (> 50 rows)
- Service down (connection refused)

**Warning** (Slack, not pager):
- Error rate > 0.1% for 10 minutes
- p99 latency > 500ms for 10 minutes
- Dual-write success < 99% for 30 minutes
- Database connection pool > 80% utilization

---

## Communication Plan

### Before Rollout

**Sept 1**: Announce "Phase 5 rollout begins Sept 15"
```
Subject: Phase 5 Production Rollout Begins Sept 15

Starting Sept 15, we're rolling out Phase 4 microservices migration 
to production in 3 stages:
- Canary (10% traffic): Sept 15-17
- Beta (50% traffic): Sept 18-24
- GA (100% traffic): Sept 25-30

All rollouts use feature flags for instant rollback. Status updates 
every 12 hours in #platform-rollout channel.

Questions? See PHASE_5_RUNBOOK.md
```

### During Rollout

**Daily updates** (9 AM, 5 PM):
```
✅ Phase 5 Canary - Day 1
- Processed 500k requests
- Error rate: 0.003% (target < 0.01%)
- p99 latency: 145ms (target < 200ms)
- Validation: ✅ Zero drift

Next: Continue monitoring. Advance to Beta on Sept 18.
```

### If Rollback

**Immediate notification**:
```
🚨 Phase 5 Canary Rolled Back

Reason: [brief reason]
Timeline: Detected at [time], rolled back by [time]
Impact: All traffic back to monolith, no customer impact
Retry: [date/time]

Details: See #platform-incidents
```

---

## Appendix: Common Issues

### Issue 1: Error Rate Spike During Canary

**Symptoms**:
- Error rate jumps from 0.003% to 0.5%
- Errors like "service unreachable" or "timeout"

**Diagnosis**:
```bash
# Check if service is still running
kubectl get pods | grep job-service

# Check service logs
kubectl logs deployment/job-service | tail -50 | grep -i error

# Check if it's making upstream calls (cross-service)
kubectl logs deployment/job-service | grep "candidate-core-service"
```

**Common causes**:
1. Service crashed (restart: `kubectl rollout restart deployment/job-service`)
2. Upstream service unreachable (check networking, firewall)
3. Database connection pool exhausted (check pool size)
4. Query timeout (check slow log, may need optimization)

**Fix**:
- If service issue: fix and redeploy
- If upstream issue: fix networking/service
- If query issue: optimize query or increase timeout
- Re-run parity tests before retry

---

### Issue 2: Drift Detected (Validation Script Fails)

**Symptoms**:
- Validation script reports "Row count mismatch: monolith=500 vs. service=480"
- Specific rows missing in service database

**Diagnosis**:
```bash
# Check which rows are missing
npx ts-node scripts/find-missing-rows.ts --table=candidate_decisions

# Check if dual-write is enabled
kubectl get env deployment/monolith | grep DUAL_WRITE_ENABLED

# Check dual-write logs in monolith
kubectl logs deployment/monolith | grep "dual.write\|mirror" | tail -50
```

**Common causes**:
1. Dual-write hook crashed (but monolith write succeeded)
2. Service database was reset (migration ran twice)
3. Backfill script didn't complete (check exit code)

**Fix**:
1. Enable `DUAL_WRITE_ENABLED=true` if disabled
2. Re-run backfill script
3. Re-run validation
4. Verify logs show no errors

---

### Issue 3: Latency Degradation Under Load

**Symptoms**:
- Canary/Beta phase fine (low load)
- But load test shows p99 > 500ms
- Or latency degrades over time (memory leak?)

**Diagnosis**:
```bash
# Check database query performance
kubectl exec -it deployment/job-service -- psql -c "SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Check service memory usage over time
kubectl top pods | grep job-service

# Check database connections
kubectl logs deployment/job-service | grep "pool.size\|connection"
```

**Common causes**:
1. N+1 query problem (loop calling service for each row)
2. Missing database index (query scans all rows)
3. Memory leak (connections not released)
4. Database is slow (check monolith load)

**Fix**:
1. Add index to database: `CREATE INDEX ...`
2. Optimize query logic (batch calls)
3. Increase connection pool size
4. Scale database (more CPU/memory)

---

## Support & Escalation

**Questions during rollout**:
- Check #platform-rollout Slack channel
- See PHASE_5_TESTING_PLAN.md for test details
- See PHASE_4_COMPLETE.md for item-by-item details

**If critical issue**:
1. Page on-call engineer (PagerDuty)
2. Execute rollback if needed
3. Post-mortem meeting 24 hours later

**Feature flag changes**:
- Only engineering team can change flags
- Must be deployed via api-gateway pod restart (Kubernetes)
- No manual flag changes on production (prevent drift)

---

**Next Step**: Execute Phase 5 testing (Sept 1-10)
**Success Criteria**: All tests pass before canary begins Sept 15
**Owner**: Platform Engineering Lead
**Status**: Ready
