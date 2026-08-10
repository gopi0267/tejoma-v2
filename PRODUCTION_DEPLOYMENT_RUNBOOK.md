# Production Deployment Runbook

**Version**: 1.0  
**Date**: 2026-08-07  
**Scope**: Phase 1 Read Operations (Steps 1, 3, 5) + Phase 2 Write Operations  
**Duration**: 4 weeks (staging 1 week + canary 2 weeks + GA 1 week)  
**Risk Level**: LOW (dual-write pattern, instant rollback)  

---

## PRE-DEPLOYMENT CHECKLIST (Week -1)

### Code Validation
- [ ] All 30+ write operations verified implemented
- [ ] All 5 Phase 1 read operations verified with feature flags
- [ ] Code review completed (static analysis, security scan)
- [ ] Linting/formatting passed
- [ ] TypeScript compilation successful

### Infrastructure Validation
- [ ] All 6 microservices deployed to staging
- [ ] Database migrations applied (all 30+ tables created/indexed)
- [ ] Cross-service network connectivity verified
- [ ] Internal endpoints (GET /internal/*) responding
- [ ] Monolith proxy routes still functional (fallback)

### Monitoring Setup
- [ ] Prometheus scrape config updated
- [ ] Grafana dashboards created
  - [ ] Error rate (by service, by endpoint)
  - [ ] Latency (p50, p95, p99)
  - [ ] Dual-write lag (monolith vs service DB)
  - [ ] Feature flag state (all 5 flags)
- [ ] Alert rules configured
  - [ ] Error rate > 1% → page
  - [ ] Dual-write lag > 5 seconds → alert
  - [ ] Service unhealthy → page
- [ ] Log aggregation (ELK/Splunk) tested
  - [ ] Service logs flowing
  - [ ] Dual-write failures searchable
  - [ ] Error traces complete

### Team Readiness
- [ ] All engineers trained on rollback procedure
- [ ] On-call rotation configured
- [ ] Escalation path defined
- [ ] Communication channels ready (Slack, status page)
- [ ] Runbook reviewed by senior engineer

---

## STAGE 1: STAGING DEPLOYMENT (Week 1)

### 1.1 Staging Environment Setup (Monday)

```bash
# Deploy Phase 1 + Phase 2 to staging
# All 6 services + monolith proxy

# 1. Update feature flags (all OFF for safety)
# job-service/.env.staging:
JOB_DETAIL_CUTOVER_ENABLED=false
RECRUITER_MATCHES_CUTOVER_ENABLED=false
CANDIDATE_RESUME_CUTOVER_ENABLED=false

# 2. Deploy services
kubectl apply -f helm/job-service/values.staging.yaml
kubectl apply -f helm/candidate-core-service/values.staging.yaml
kubectl apply -f helm/candidate-service/values.staging.yaml
kubectl apply -f helm/matching-decision-service/values.staging.yaml
kubectl apply -f helm/recruiting-service/values.staging.yaml
kubectl apply -f helm/chat-service/values.staging.yaml

# 3. Verify all services healthy
kubectl get pods -n staging
kubectl logs -f deployment/job-service -n staging

# 4. Verify monolith reachable
curl https://staging-monolith/health
```

**Validation**: All 6 services + monolith responding to health checks

### 1.2 Unit Tests (Monday-Tuesday)

```bash
# Run all unit tests for new implementations
npm test --workspace=job-service
npm test --workspace=candidate-core-service
npm test --workspace=candidate-service
npm test --workspace=matching-decision-service
npm test --workspace=recruiting-service
npm test --workspace=chat-service

# Success Criteria:
# - All new handler functions tested
# - All new service clients tested
# - All new feature flags tested
# - > 95% coverage on new code
```

**Validation**: All unit tests passing, coverage > 95%

### 1.3 Integration Tests (Tuesday-Wednesday)

```bash
# Test full request flow through API Gateway
# Phase 1 Steps 1, 3, 5 (read operations)
# Phase 2 (write operations)

npm test:integration --suite=phase1-reads
npm test:integration --suite=phase2-writes

# Test Each Endpoint:
# GET /api/jobs/:id (feature flag OFF → 404, true → ranked candidates)
# GET /api/candidates/:id/resume (feature flag OFF → 404, true → resume)
# GET /api/recruiter-matches (feature flag OFF → monolith proxy, true → service)
# POST /api/candidates (write locally + dual-write monolith)
# POST /api/swipes (write locally + dual-write + orchestration)
# PUT /api/candidate-profile/me (write locally)
# All other write operations (verify write succeeds)

# Success Criteria:
# - All requests succeed
# - No cascading failures
# - All dual-writes complete within 5 seconds
# - Monolith records updated within 5 seconds
```

**Validation**: All integration tests passing, dual-writes verified

### 1.4 A/B Parity Testing (Wednesday-Thursday)

```bash
# Compare service response vs monolith response
# For each endpoint: call both, verify JSON deep-equal

npm test:parity --suite=phase1-reads
npm test:parity --suite=phase2-writes

# Example Test:
# 1. POST /api/candidates (to service)
#    Response A: { id: 1, name: "John", email: "john@..." }
#
# 2. Query monolith DB directly
#    Response B: { id: 1, name: "John", email: "john@..." }
#
# 3. Verify A === B (no field differences)
#
# Success Criteria:
# - 100% parity on all 30+ operations
# - No field mismatches
# - No timing issues
```

**Validation**: All A/B parity tests passing, zero drift

### 1.5 Performance Testing (Thursday-Friday)

```bash
# Load test: 50 req/s per endpoint for 1 hour
# Measure: latency, error rate, connection leaks

npm run test:performance --load=50 --duration=3600

# Success Criteria:
# P50 latency: < 200ms
# P95 latency: < 500ms
# P99 latency: < 1000ms
# Error rate: < 0.01%
# No connection leaks
# Dual-write lag: < 5 seconds
```

**Validation**: Performance targets met, no regressions

### 1.6 Staging Sign-Off (Friday)

```bash
# Checklist:
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All A/B parity tests passing
- [ ] All performance tests passing
- [ ] No security issues found
- [ ] No data loss possible
- [ ] Rollback tested (flip flags, services restart)
- [ ] Team review completed
- [ ] Status page draft ready
- [ ] On-call briefing scheduled

# Sign-off from:
- [ ] Tech Lead
- [ ] QA Lead
- [ ] Ops Lead
```

**Validation**: Staging sign-off received, ready for production canary

---

## STAGE 2: CANARY PRODUCTION (Week 2-3)

### 2.1 Canary 10% Deployment (Monday Week 2)

```bash
# Update feature flags: ENABLE FOR 10% OF REQUESTS
# Using request ID or cookie-based routing

# job-service/.env.production:
JOB_DETAIL_CUTOVER_ENABLED=true
CANARY_PERCENTAGE=10

# Deployment strategy:
# 1. Deploy Phase 1 + Phase 2 to 10% of pods
# 2. Route 10% of incoming requests to new pods
# 3. Keep 90% on monolith proxy (old pods)

kubectl set image deployment/job-service \
  job-service=job-service:v2.0-canary \
  --record -n production

# 4. Verify rollout
kubectl rollout status deployment/job-service -n production
kubectl get pods -n production | grep job-service

# 5. Check metrics immediately
# - Error rate should be < 0.1% (baseline)
# - Latency should be similar to baseline
# - Dual-write lag should be < 5 seconds
```

**Validation**: 10% canary deployed, metrics normal

### 2.2 Canary Monitoring (48 hours)

```bash
# Continuous monitoring dashboard:
# - Error rate (target: < 0.01%)
# - Latency P99 (target: < 1000ms)
# - Dual-write lag (target: < 5s)
# - Parity drift (target: 0 mismatches)

# Alert thresholds (page on-call if triggered):
# - Error rate > 1% for > 5 minutes
# - Dual-write lag > 10 seconds
# - Service unhealthy (health check failing)
# - Pod crashing (restart loops)

# On-call response:
# If alert triggered:
#   1. Assess severity
#   2. If critical: flip flag to false (instant rollback)
#   3. Restart affected pods
#   4. Investigate root cause
#   5. Fix and redeploy

# Manual Checks (4x daily):
# - tail -f logs/job-service/production.log
# - Check error messages
# - Verify dual-writes in monolith
# - Spot-check API responses
```

**Success Criteria**: 48 hours with:
- Error rate < 0.01%
- Zero parity drift
- Dual-write lag < 5s consistently
- Zero critical alerts

### 2.3 Canary 50% Deployment (Wednesday Week 2)

```bash
# Update feature flags: ENABLE FOR 50% OF REQUESTS
CANARY_PERCENTAGE=50

# Gradual rollout:
# 1. Update deployment
# 2. Monitor for 1 hour
# 3. If stable: continue
# 4. If issues: roll back to 10%

# Success Criteria (7 days):
# - Error rate < 0.05%
# - Latency stable
# - Dual-write consistency verified
# - No data loss
# - No cascading failures
```

**Success Criteria**: 7 days at 50% with no incidents

### 2.4 Canary 100% Deployment (Monday Week 3)

```bash
# Update feature flags: ENABLE FOR 100% OF REQUESTS
CANARY_PERCENTAGE=100

# Full production rollout:
# 1. Update all deployment replicas
# 2. Monitor continuously
# 3. Verify all traffic routing to services
# 4. Keep monolith proxy as fallback (feature flags remain)

# Success Criteria (5 days):
# - Error rate < 0.05%
# - Latency stable
# - Zero alerts (>3 hours baseline needed to rule out flakes)
# - Dual-write lag minimal
# - All 30+ operations working
```

**Success Criteria**: 5 days at 100% with zero incidents

---

## STAGE 3: PRODUCTION GA (Week 4)

### 3.1 Decommission Proxy Routes (Monday)

```bash
# Once 100% canary stable for 5 days:
# Remove monolith proxy routes from API Gateway

# Before:
# GET /api/jobs/:id
#   -> if JOB_DETAIL_CUTOVER_ENABLED: job-service
#   -> else: monolith proxy

# After:
# GET /api/jobs/:id
#   -> job-service (direct, no conditional)

# Procedure:
# 1. Update API gateway routes
# 2. Redeploy API gateway
# 3. Monitor for issues
# 4. If issues: revert (5 minute rollback)
```

**Validation**: All routes pointing directly to services

### 3.2 Remove Feature Flags (Tuesday)

```bash
# Once proxy routes removed and stable:
# Remove feature flag code from service handlers

# Before:
if (JOB_DETAIL_CUTOVER_ENABLED) {
  return getJobDetail(...);
} else {
  return proxyToMonolith(...);
}

# After:
return getJobDetail(...);  // Direct implementation

# Procedure:
# 1. Remove flag from env.ts
# 2. Remove flag from .env.local
# 3. Remove conditional logic from handlers
# 4. Simplify code
# 5. Redeploy services
```

**Validation**: All feature flags removed, code simplified

### 3.3 Optional: Remove Dual-Writes (Week 4+, after 30 days)

```bash
# After 30 days in production with dual-writes enabled:
# If zero sync issues and full confidence:
# Remove dual-write to monolith (optional)

# Procedure (AFTER 30 DAYS):
# 1. Disable dual-write in code
# 2. Monitor for issues
# 3. If stable: remove dual-write code entirely
# 4. Monolith becomes read-only reference (backup)

# Note: Only do this after verified stability
# Keep dual-write if you want extra safety margin
```

**Decision Point**: Keep dual-writes for safety or remove after 30 days

### 3.4 GA Sign-Off (Friday)

```bash
# Final checklist:
- [ ] 100% traffic on services (5 days stable)
- [ ] Proxy routes decommissioned
- [ ] Feature flags removed
- [ ] All 30+ endpoints working
- [ ] Error rate < 0.05%
- [ ] No data loss
- [ ] No cascading failures
- [ ] Monolith still running (backup)
- [ ] Monitoring stable
- [ ] On-call briefed
- [ ] Status page updated
```

**Validation**: GA sign-off received, Phase 1 + 2 production-ready

---

## ROLLBACK PROCEDURES

### Instant Rollback (< 1 minute)

**If critical issue during canary:**

```bash
# Option 1: Flip feature flag
# Edit .env.production
JOB_DETAIL_CUTOVER_ENABLED=false

# Restart affected service
kubectl rollout restart deployment/job-service -n production

# Traffic reverts to monolith proxy
# Error rate should drop within 30 seconds

# Option 2: Scale down canary pods
kubectl scale deployment job-service --replicas=0 -n production

# Old pods (monolith proxy) handle all traffic
```

**Decision Tree:**
- Error rate > 5%? → Flip flag
- Dual-write lag > 30s? → Flip flag
- Data corruption? → Flip flag + investigate
- Timeout in new code? → Flip flag
- All other issues? → Page on-call + investigate

### Full Rollback (if needed)

```bash
# If unable to flip flag fast enough:
# Revert entire deployment

kubectl rollout undo deployment/job-service -n production

# Reverts to previous image (monolith proxy version)
# No data loss (dual-write preserved consistency)
```

---

## MONITORING & ALERTING

### Prometheus Metrics

```yaml
# Error Rate (by service)
rate(http_request_errors_total[5m])

# Latency (P99)
histogram_quantile(0.99, http_request_duration_seconds)

# Dual-Write Lag
monolith_write_lag_seconds

# Feature Flag State
feature_flag_enabled{flag="JOB_DETAIL_CUTOVER"}
```

### Alert Rules

```yaml
groups:
  - name: canary-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_request_errors_total[5m]) > 0.01
        for: 5m
        action: page

      - alert: HighLatency
        expr: histogram_quantile(0.99, http_request_duration_seconds) > 1.0
        for: 5m
        action: alert

      - alert: DualWriteLag
        expr: monolith_write_lag_seconds > 10
        for: 2m
        action: page

      - alert: ServiceUnhealthy
        expr: up{job="job-service"} == 0
        for: 1m
        action: page
```

---

## COMMUNICATION PLAN

### Status Page Updates
- Pre-deployment: "Scheduled maintenance window"
- During canary: "Gradual service migration (monitoring)"
- Post-GA: "Migration complete, all systems normal"

### Slack Notifications
- Start of each stage
- End of each stage
- Any critical alerts

### Weekly Reports
- Error rate trend
- Latency trend
- Feature comparison (service vs monolith)
- Team feedback

---

## TEAM ROLES & RESPONSIBILITIES

### Tech Lead
- Reviews code + runbook
- Approves each stage progression
- Escalation point for architecture issues

### QA Lead
- Runs all test suites
- Verifies A/B parity
- Signs off on each stage

### Ops Lead
- Manages Kubernetes deployments
- Monitors infrastructure
- Handles scaling/performance issues

### On-Call Engineer
- Monitors alerts 24/7 during canary
- Responds to pages
- Performs rollbacks if needed
- Communicates with Slack channel

### PM/Product
- Updates status page
- Communicates with stakeholders
- Tracks business metrics

---

## SUCCESS CRITERIA (Overall)

✅ **Stage 1 (Staging)**: All tests passing, sign-off received  
✅ **Stage 2 (Canary 10%)**: 48 hours with error < 0.01%  
✅ **Stage 2 (Canary 50%)**: 7 days with error < 0.05%  
✅ **Stage 2 (Canary 100%)**: 5 days with error < 0.05%, zero critical alerts  
✅ **Stage 3 (GA)**: Proxy routes removed, feature flags removed, production-ready  

**Total Duration**: 4 weeks  
**Total Cost**: 1 Platform Engineer + 1 On-Call Engineer  
**Risk**: LOW (dual-write pattern, instant rollback)  

---

**Prepared by**: Claude Code  
**Date**: 2026-08-07  
**Status**: READY FOR EXECUTION
