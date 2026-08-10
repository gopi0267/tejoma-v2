# Production Canary Deployment — Phase 3: 10% Traffic

**Date**: August 10, 2026  
**Status**: CANARY ACTIVE — 10% TRAFFIC  
**Duration**: Continuous monitoring for 4-8 hours

---

## Configuration Applied

### Feature Flags

```
CANARY_PERCENTAGE=10               ← 10% traffic through microservice-only path
MONOLITH_FALLBACK_ENABLED=true     ← Fallback enabled for safety (90% of traffic)
DUAL_WRITE_ENABLED=false           ← No writes to monolith
```

### Traffic Routing

| Traffic Percentage | Path | Safety Level | Fallback | Notes |
|---|---|---|---|---|
| 10% (Canary) | Microservices only | High risk | None | Uses proven microservices-only configuration |
| 90% (Baseline) | Microservices + Fallback | Low risk | Enabled | Can fall back to monolith if needed |

---

## Deployment Status

### API Gateway

✅ **Rebuilt** with canary support  
✅ **Status**: Healthy  
✅ **Version**: Includes CANARY_PERCENTAGE routing logic  
✅ **Behavior**: Routes requests to canary/baseline paths based on hash

### Microservice Health (All 19 services)

| Service | Status | Database | Healthy |
|---------|--------|----------|---------|
| identity-service | ✅ Up | tejoma_identity | Yes |
| job-service | ✅ Up | tejoma_job | Yes |
| candidate-core-service | ✅ Up | tejoma_candidate_core | Yes |
| matching-decision-service | ✅ Up | tejoma_matching_decision | Yes |
| analytics-service | ✅ Up | tejoma_analytics | Yes |
| (15 additional services) | ✅ All Up | Respective DBs | Yes |

### Supporting Services

✅ **Redis**: PONG (operational)  
✅ **Nginx**: Healthy, HTTPS active  
✅ **Prometheus**: 26 targets scraping  
✅ **Grafana**: Dashboards available  
✅ **PostgreSQL**: Connected, accessible  

---

## Canary Request Routing Logic

### How It Works

Each request is hashed based on:
- Authorization header (if present), OR
- IP + User-Agent combination

**Hash Value**: Consistent routing — same user always routes the same way

**Routing Decision**:
- If hash % 100 ≤ CANARY_PERCENTAGE (10): Canary path (microservices only, no fallback)
- Otherwise: Baseline path (microservices + fallback)

### Canary Path Behavior (10%)

```
Request → API Gateway
  ↓
Route matches microservice? → YES → Proxy to microservice
Route does NOT match microservice? → Return 404 (no fallback allowed)
  ↓
Result: Microservice traffic only, migrated routes fully functional, 
        unmigrated routes blocked with 404
```

### Baseline Path Behavior (90%)

```
Request → API Gateway
  ↓
Route matches microservice? → YES → Proxy to microservice
Route does NOT match microservice? → Fallback to monolith
  ↓
Result: Same as before - migrated routes use microservices, 
        unmigrated routes use monolith fallback
```

---

## Monitoring Setup

### Key Metrics to Track (4-8 Hour Window)

**Request Volume**:
- Total requests
- Canary path requests (should be ~10%)
- Baseline path requests (should be ~90%)

**Error Rates**:
- 4xx errors (especially 404 on canary path)
- 5xx errors (service failures)
- Compare canary vs baseline error rates

**Latency** (P50/P95/P99):
- Microservice response times
- Monolith response times
- Canary vs baseline comparison

**Service Health**:
- No unexpected service restarts
- No connection failures
- Database queries functioning normally

**Data Consistency**:
- No duplicate records
- No missing writes
- Microservice databases consistent

### Prometheus Queries (Available at http://localhost:9090)

```promql
# 10% Traffic Through Canary
rate(http_requests_total{path=~"/api/.*"}[5m])

# Error Rate (Canary)
rate(http_requests_total{path=~"/api/.*", status=~"5.."}[5m])

# Response Time (Canary)
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Service Restarts
increase(container_restarts[1h])
```

### Grafana Dashboard

**Dashboard**: Tejoma - Overview (provisioned)  
**Metrics**:
- HTTP Rate / Latency
- Container CPU / Memory
- Request Counts by Service
- Error Rates

---

## Safety Mechanisms

### Automatic Rollback Triggers

If any of these occur, stop the canary and investigate:

1. **5xx Error Rate Spike**: > 5% of requests (indicates service failure)
2. **Latency Spike**: P95 > 2x baseline (indicates performance regression)
3. **Service Restart**: Unexpected restart of any microservice
4. **Database Error**: Connection or query failures
5. **Data Loss**: Missing records or data inconsistency

### Manual Rollback

If issues detected:

```bash
# 1. Restore fallback enabled (safe configuration)
export CANARY_PERCENTAGE=0
export MONOLITH_FALLBACK_ENABLED=true

# 2. Rebuild API Gateway
docker compose build api-gateway
docker compose up -d api-gateway

# 3. Monitor recovery
docker logs tejoma-api-gateway-1
docker compose ps
```

---

## Baseline Comparison (Production)

### Before Canary (100% Fallback-Enabled)

| Metric | Baseline | Unit |
|--------|----------|------|
| Average Response Time | < 200ms | milliseconds |
| P95 Latency | < 500ms | milliseconds |
| Error Rate | < 1% | percent |
| 5xx Errors | None | count/min |
| Service Restarts | 0 | count/4hrs |
| Database Errors | 0 | count/4hrs |

### During Canary (10% Microservices Only)

Expected behavior:

| Metric | Expected | Notes |
|--------|----------|-------|
| Average Response Time | Similar or faster | Microservices may be more efficient |
| P95 Latency | Similar or faster | Less overhead without fallback check |
| Error Rate (Canary) | Similar | Same services handling traffic |
| Error Rate (Baseline) | Similar | Fallback still available |
| 5xx Errors | None | No expected failures |
| Service Restarts | 0 | Services are stable |
| Database Errors | 0 | No expected DB issues |

### Success Criteria for Phase 3 → Phase 4

All of these must be true to proceed to 25%:

- ✅ No 5xx errors during canary window (or < 0.1%)
- ✅ Response latency stable (no spikes)
- ✅ No service restarts
- ✅ No database errors
- ✅ Data consistency verified
- ✅ Canary traffic actually routing (logs show ~10% split)
- ✅ Baseline traffic using fallback (logs show ~90% with monolith routing)

---

## Monitoring Duration

**Phase 3 Minimum**: 4 hours (overnight or morning shift)  
**Phase 3 Maximum**: 8 hours (full business day)  
**Decision Point**: After 4-8 hours, review metrics and decide:

- **HEALTHY**: Proceed to Phase 4 (25% Canary)
- **DEGRADED**: Investigate, resolve, then resume canary OR rollback
- **CRITICAL**: Immediate rollback to Phase 2

---

## Next Steps

After 4-8 hour monitoring window:

1. **Analyze metrics** (Prometheus/Grafana)
2. **Review logs** for errors or issues
3. **Compare canary vs baseline** performance
4. **Decision**:
   - If healthy: Proceed to Phase 4 (25% canary)
   - If issues: Investigate and resolve, OR rollback to Phase 2

---

## Canary Percentage Progression Plan

If Phase 3 succeeds:

| Phase | Canary % | Baseline % | Duration |
|-------|----------|-----------|----------|
| Phase 3 (Current) | 10% | 90% | 4-8 hours |
| Phase 4 | 25% | 75% | 4-8 hours |
| Phase 5 | 50% | 50% | 8+ hours |
| Phase 6 | 100% | 0% | 24+ hours (monitor) |

---

**Canary Start Time**: August 10, 2026, ~14:00 UTC  
**Expected Decision Time**: August 10, 2026, ~18:00-22:00 UTC  
**Status**: ACTIVE — MONITORING IN PROGRESS

