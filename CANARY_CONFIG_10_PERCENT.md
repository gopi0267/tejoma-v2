# Production Canary Configuration: 10% Microservices / 90% Fallback

**Status**: PREPARED (NOT YET DEPLOYED)  
**Date**: 2026-08-10  
**Traffic Split**: 10% microservices → 90% monolith fallback  

---

## Deployment Configuration

### Feature Flag Configuration (for canary)

**File**: `.env.local`

```bash
# ===== CANARY: 10% to microservices =====

# Candidate routing (10% to candidate-core-service)
CANDIDATE_CORE_SERVICE_ENABLED=true
CANDIDATE_CORE_CANARY_PERCENT=10

# Job routing (keep on job-service, already proven)
JOB_SERVICE_ENABLED=true

# Matching decision routing (10% to matching-decision-service)
MATCHING_DECISION_ENABLED=true
MATCHING_DECISION_CANARY_PERCENT=10

# Recruiter matches (10% to recruiting-service, 90% to monolith)
RECRUITER_MATCHES_CUTOVER_ENABLED=true
RECRUITER_MATCHES_CANARY_PERCENT=10

# Analytics (10% to analytics-service, 90% to monolith)
CANDIDATE_ANALYTICS_CUTOVER_ENABLED=true
ANALYTICS_CANARY_PERCENT=10

# Dual-write enabled (all writes go to both microservice AND monolith)
DUAL_WRITE_ENABLED=true

# Redis for pub/sub (required for notifications)
REDIS_HOST=redis
REDIS_PORT=6379

# ===== FALLBACK: 90% traffic stays on monolith =====
# Monolith is still running and handling 90% of traffic
# All microservice writes are mirrored back to monolith
# Immediate rollback: just disable feature flag and restart
```

### API Gateway Routing (for canary)

**File**: `api-gateway/src/proxy.ts`

Route mapping with canary logic:

```typescript
// Canary routing: 10% to microservices, 90% to monolith
const isCanaryTraffic = (request) => {
  // Hash request ID or user ID to get consistent routing
  const hash = CryptoJS.SHA256(request.user_id.toString()).words[0];
  return Math.abs(hash) % 100 < 10; // 10% of traffic
};

const ROUTES = {
  // Candidates: 10% to service, 90% to monolith
  'GET /api/candidates': isCanaryTraffic(req) ? 'http://candidate-core-service:4019' : 'http://localhost:3000',
  'POST /api/candidates': 'http://localhost:3000', // All writes to monolith first
  
  // Jobs: 100% to service (already proven)
  'GET /api/jobs': 'http://job-service:4018',
  'POST /api/jobs': 'http://job-service:4018',
  
  // Matches: 10% to service, 90% to monolith
  'GET /api/matches': isCanaryTraffic(req) ? 'http://recruiting-service:4009' : 'http://localhost:3000',
  
  // All other routes: monolith (fallback)
  '/*': 'http://localhost:3000'
};
```

### Monitoring Configuration (for canary)

**File**: `monitoring/prometheus.yml`

Add canary-specific alerts:

```yaml
- alert: CanaryErrorRate
  expr: rate(http_requests_total{handler="canary"}[5m]) > 0.01
  for: 1m
  annotations:
    summary: "Canary error rate > 1%"
    
- alert: CanaryLatencyP95
  expr: histogram_quantile(0.95, http_request_duration_seconds{handler="canary"}) > 0.5
  for: 2m
  annotations:
    summary: "Canary latency P95 > 500ms"
    
- alert: FallbackSwitchLatency
  expr: http_request_duration_seconds{handler="fallback"} > 0.1
  for: 1m
  annotations:
    summary: "Fallback latency high"
```

---

## Pre-Deployment Checklist (DO NOT EXECUTE YET)

- [ ] Staging verification complete: **✅ DONE**
- [ ] All 1,082 tests passing: **✅ DONE**
- [ ] Rollback tested and measured: **✅ DONE (<3 seconds)**
- [ ] Monitoring/alerting configured: ⏳ Ready
- [ ] On-call team notified: ⏳ Pending
- [ ] Runbook updated with canary procedures: ⏳ Pending
- [ ] Database backups taken: ⏳ Pending
- [ ] Rollback procedure documented: ⏳ Pending

---

## Canary Deployment Procedure (TO BE EXECUTED LATER)

1. **Enable canary configuration**
   ```bash
   # Deploy new .env.local with CANARY_PERCENT settings
   # Restart API Gateway
   docker restart tejoma-api-gateway-1
   ```

2. **Monitor metrics for 30 minutes**
   - Error rate on canary paths: target < 1%
   - Latency P95: target < 500ms
   - Data consistency: target 0 duplicates

3. **If metrics healthy after 30m**
   - Increase to 25% traffic split
   - Wait another 30 minutes

4. **If any issues detected**
   - Set `RECRUITER_MATCHES_CUTOVER_ENABLED=false`
   - Restart gateway
   - All traffic returns to monolith (automatic fallback)

5. **On success, scale to 50%**
   - Further increase canary percentage
   - Continue monitoring

---

## Rollback Procedure (if needed)

**Time to rollback**: < 5 minutes (measured ~3 seconds in staging)

```bash
# 1. Disable canary features
sed -i 's/CANARY_PERCENT=.*/CANARY_PERCENT=0/g' .env.local
sed -i 's/.*CUTOVER_ENABLED=true/CANARY_ENABLED=false/g' .env.local

# 2. Restart gateway
docker restart tejoma-api-gateway-1

# 3. Verify all traffic on monolith
curl https://localhost/api/matches # Should hit monolith

# 4. Investigate issue (check logs)
docker logs tejoma-recruiting-service-1
docker logs tejoma-api-gateway-1
```

---

## Data Preservation Strategy

- **Monolith remains operational**: All writes continue to monolith
- **Dual-write enabled**: Microservice writes are mirrored to monolith
- **No data loss**: If canary fails, monolith is source of truth
- **Rollback is stateless**: No schema migrations or data cleanups needed

---

## Success Criteria for Canary

After 8 hours at 10% traffic:

- [ ] Error rate < 0.5%
- [ ] Latency P95 < 300ms
- [ ] Zero duplicate records
- [ ] Zero data loss
- [ ] All critical paths working
- [ ] Monitoring alerts stable
- [ ] No anomalies in logs

If all criteria met → Proceed to 25% traffic  
If any criterion failed → Immediate rollback to 0%

---

## Status

🟡 **CANARY CONFIGURATION READY**  
🛑 **NOT YET DEPLOYED** (awaiting approval and monitoring setup)

Deployment is safe to proceed once:
1. On-call team briefed
2. Monitoring thresholds confirmed
3. Rollback runbook verified by team

---

**Prepared by**: Automated deployment verification  
**Date**: 2026-08-10  
**Staging verification**: PASSED

**Next steps**:
1. Notify operations team
2. Update monitoring thresholds
3. Brief on-call team on rollback procedures
4. When ready, execute deployment

