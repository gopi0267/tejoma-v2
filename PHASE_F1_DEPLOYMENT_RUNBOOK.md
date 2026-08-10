# Phase F-1 Canary Deployment Runbook

**Phase**: F-1 (Canary)  
**Traffic**: 5%  
**Duration**: 48 hours  
**Start Date**: 2026-08-18  
**Status**: Ready to execute

---

## Pre-Deployment Checklist (T-24 hours)

### ✅ Prerequisite Verification

```bash
# 1. Verify all services are healthy in Docker Compose
docker compose ps
# Expected: All services running and healthy

# 2. Verify TypeScript compiles
npm run build
# Expected: No errors (except pre-existing read-xml.js)

# 3. Verify database migrations are ready
ls -la matching-scoring-service/migrations/
ls -la matching-reasoning-service/migrations/
ls -la resume-service/migrations/
# Expected: All .up.sql files present

# 4. Verify configuration
cat .env.local | grep CUTOVER
# Expected: All flags set to false for Phase F-1

# 5. Verify monitoring dashboards
# Open: http://localhost:3000 (Grafana)
# Expected: Prometheus datasource configured
```

### ✅ Team Notifications

- [ ] Notify infrastructure/ops team
- [ ] Brief development team
- [ ] Alert on-call team to stand by
- [ ] Schedule post-deployment retro (48h + 24h)
- [ ] Verify escalation procedures understood

### ✅ Infrastructure Preparation

```bash
# 1. Backup database
pg_dump tejoma_recruiting > backup-2026-08-18-pre-f1.sql

# 2. Verify Kubernetes cluster ready (if using K8s)
kubectl cluster-info
# OR verify Docker Compose network
docker network ls | grep tejoma

# 3. Verify secrets/credentials in place
# Check: Database credentials, API keys, JWT secrets
cat .env.local | head -20

# 4. Prepare rollback scripts
# Ensure these are accessible in on-call runbooks:
# - Flag disable script
# - Pod restart script
# - Database restore procedure
```

---

## Deployment Execution (T+0)

### Step 1: Start Fresh Build (10 min)

```bash
# Clean build of all Docker images
docker compose build --no-cache

# Expected output:
# - app: built successfully
# - matching-scoring-service: built successfully
# - matching-reasoning-service: built successfully
# - resume-service: built successfully
# - All other services: built successfully
```

### Step 2: Verify Configuration (5 min)

```bash
# Verify all cutover flags are DISABLED for Phase F-1
grep -E "CUTOVER|CANARY" .env.local

# Expected output:
# CAREER_TRAJECTORIES_CUTOVER_ENABLED=false
# REASONING_CONCLUSIONS_CUTOVER_ENABLED=false
# RAG_INDEXING_CUTOVER_ENABLED=false
# CANARY_PERCENTAGE=5
```

### Step 3: Start Deployment (5 min)

**Option A: Docker Compose (Development/Staging)**
```bash
# Stop old containers
docker compose down

# Start fresh with all services
docker compose up -d

# Watch for health checks
docker compose ps
# Monitor until all services show "healthy"
```

**Option B: Kubernetes (Production)**
```bash
# If deploying to Kubernetes:
CUTOVER_PHASE=1 bash scripts/deploy.sh

# Watch deployment progress
kubectl rollout status deployment/app -n tejoma
kubectl get pods -n tejoma

# Expected: All pods running and ready
```

### Step 4: Immediate Health Check (5 min)

```bash
# Test API connectivity
curl -s http://localhost:3006/api/health | jq .

# Expected: { "status": "ok", "timestamp": "..." }

# Check Gateway
curl -s http://localhost:4000/health | jq .

# Expected: 200 OK, all services healthy

# Verify Redis
redis-cli -p 6379 ping
# Expected: PONG

# Monitor Prometheus targets
curl -s http://localhost:9090/api/v1/targets | jq '.data | length'
# Expected: 25+ targets scraping
```

---

## Monitoring Phase (T+0 to T+48h)

### Real-Time Dashboards

**Grafana** (http://localhost:3000)
- Overview Dashboard: Monitor request rate, error rate, latency, memory, CPU
- Cutover Status Dashboard: Verify flag values, service-to-monolith call ratios

**Prometheus** (http://localhost:9090)
- Alerts: Check for any firing alerts
- Targets: Verify all services scraping

### Key Metrics to Watch

**Critical** (Alert if threshold breached):
- [ ] Error rate > 1% (target: < 0.1%)
- [ ] Latency P99 > 2s (target: < 1s)
- [ ] Service availability < 99% (target: > 99.9%)
- [ ] Memory usage > 85% (target: < 80%)

**Warning** (Monitor for trends):
- [ ] Database connection pool usage > 70%
- [ ] Request latency P50 > 200ms
- [ ] Cache hit rate < 80%

### Hourly Checks (First 12 hours)

```bash
# Every hour, run this check script:
./tests/e2e-verification.sh
# Expected: All tests passing

# Monitor logs
docker logs app 2>&1 | tail -50 | grep -i "error\|warning"
# Expected: No error patterns, normal operation

# Check database connections
psql -U postgres tejoma_recruiting -c "SELECT count(*) FROM pg_stat_activity;"
# Expected: < 20 connections, stable trend
```

### Dashboard Snapshots (Baseline Establishment)

**At T+0h:**
- Screenshot Grafana overview (baseline)
- Screenshot Prometheus alerts page
- Screenshot Redis monitoring
- Log: Request counts, error counts, latency percentiles

**At T+24h:**
- Take same screenshots (compare with baseline)
- Note any deviations or anomalies

**At T+48h:**
- Final snapshots for go/no-go decision

---

## Go/No-Go Decision (T+48h)

### Success Criteria (Must ALL be met)

```
✅ Error Rate
   Target: < 0.1%
   Acceptance: < 0.5%
   
✅ Latency (P99)
   Target: < 1s
   Acceptance: < 2s
   
✅ Service Availability
   Target: > 99.9%
   Acceptance: > 99%
   
✅ No Critical Alerts
   Status: 0 firing alerts
   Acceptance: < 2 critical (if low priority)
   
✅ Database Health
   Connections: < 20 active
   Query performance: No degradation
   Replication lag: < 100ms
   
✅ Memory/CPU
   Memory: < 80% of limits
   CPU: < 70% of limits
   No OOM kills
   
✅ Cutover Flag Integrity
   Monolith mirroring working
   Service data consistent with monolith
   No flag mismatches
```

### Failure Criteria (Any one triggers rollback)

```
❌ Error rate > 5% for > 5 min
❌ Service unavailable for > 5 min
❌ Database connection pool exhausted
❌ Monolith CPU > 90%
❌ Memory leak detected (increasing trend)
❌ Data consistency issue detected
❌ Critical alert firing for > 30 min
```

### Decision Process

**If GO (All success criteria met)**:
```
1. Review monitoring data with team
2. Confirm no data consistency issues
3. Approve Phase F-2a deployment
4. Schedule canary runback (optional)
5. Archive logs and metrics
6. Update deployment timeline
```

**If NO-GO (Any failure criteria)**:
```
1. Trigger Rollback Level 1 (flag disable)
2. Wait 5 min for services to restart
3. Verify monolith handling 100% traffic
4. Investigate root cause
5. Document findings
6. Schedule post-incident review
7. Fix issues before retry
```

---

## Rollback Procedures

### Rollback Level 1: Flag Disable (30 seconds)

**When to use**: Service bug in new code, data consistency issue  
**Impact**: Instant return to monolith for affected feature  
**Steps**:

```bash
# Disable the problematic cutover flag
kubectl patch configmap tejoma-config -n tejoma \
  -p '{"data":{"FLAG_NAME":"false"}}'

# OR edit directly
kubectl edit configmap tejoma-config -n tejoma

# Restart all pods to pick up new config
kubectl rollout restart deployment --all -n tejoma

# Verify
kubectl get pods -n tejoma

# Monitor logs
kubectl logs -f deployment/app -n tejoma
```

### Rollback Level 2: Pod Restart (30 seconds)

**When to use**: Pod crash, hung process  
**Impact**: Service temporarily unavailable, then restored  
**Steps**:

```bash
# Restart single service
kubectl rollout restart deployment/SERVICE_NAME -n tejoma

# Restart all services
kubectl rollout restart deployment --all -n tejoma

# Monitor rollout
kubectl rollout status deployment/SERVICE_NAME -n tejoma
```

### Rollback Level 3: Gateway Fallback (Automatic)

**When to use**: Service completely down, no rollback needed  
**Impact**: Transparent to users, gateway routes to monolith automatically  
**Steps**: None - automatic

**Verify fallback working**:
```bash
# Kill a service pod
kubectl delete pod POD_NAME -n tejoma

# Attempt a request
curl -s http://localhost/api/endpoint

# Expected: 200 OK (served by monolith fallback)
```

---

## Communication Templates

### Start of Deployment Email

```
Subject: Tejoma Phase F-1 Canary Deployment Starting

We are beginning Phase F-1 canary deployment of Tejoma's 
microservices migration. 

Timeline:
- Start: 2026-08-18 09:00 UTC
- Canary Traffic: 5%
- Duration: 48 hours
- Go/No-Go Decision: 2026-08-20 09:00 UTC

Monitoring:
- Grafana: http://monitoring.example.com/grafana
- On-Call: PHONE_NUMBER
- Escalation: escalation@example.com

Please avoid:
- Major deployments during monitoring window
- Database maintenance during this period
- Configuration changes

Questions? Contact: engineering@example.com
```

### 24-Hour Status Update

```
Subject: Tejoma Phase F-1 - 24h Status Update

Metrics at 24-hour mark:
- Error rate: X.XX% (target: < 0.1%)
- P99 latency: XXXms (target: < 1000ms)
- Service availability: X.XX% (target: > 99.9%)
- Critical alerts: N (target: 0)

Database:
- Connections: X (healthy)
- Replication lag: XXms (healthy)

Status: ON TRACK for go/no-go decision

Next milestone: T+48h final assessment
```

### Go Decision Email

```
Subject: Tejoma Phase F-1 ✅ APPROVED - Proceeding to Phase F-2a

Phase F-1 canary deployment completed successfully.
All success criteria met.

Metrics:
- Error rate: X.XX% ✅
- Latency: XXXms ✅
- Availability: X.XX% ✅
- Alerts: 0 ✅

We are proceeding to Phase F-2a (Career Trajectories Cutover)
scheduled for 2026-08-25.

Next phase will shift 25% traffic to new services.
```

### No-Go Rollback Email

```
Subject: Tejoma Phase F-1 ⚠️ ROLLBACK INITIATED

An issue was detected during Phase F-1 canary.

Issue: [DESCRIPTION]
Impact: [AFFECTED FEATURE]
Action: Rollback Level [1/2/3] initiated

Timeline:
- Detection: 2026-08-18 XX:XXZ
- Rollback: 2026-08-18 XX:XXZ
- Recovery: 2026-08-18 XX:XXZ
- Root cause analysis: In progress

Services affected: [LIST]
Services not affected: [LIST]

We will retry Phase F-1 after fixes.
Estimated retry: [DATE]
```

---

## Post-Deployment Procedures

### If GO (48h + 24h):

```bash
# 1. Archive baseline metrics
mkdir -p deployments/f1-baseline
cp grafana-screenshot-t0h.png deployments/f1-baseline/
cp grafana-screenshot-t48h.png deployments/f1-baseline/

# 2. Generate final report
./scripts/generate-deployment-report.sh F-1

# 3. Create runback procedure (optional, for quick rollback)
./scripts/create-runback-snapshot.sh F-1

# 4. Schedule Phase F-2a
# Update deployment calendar
# Notify teams of next milestone
```

### If NO-GO (Rollback + Retry):

```bash
# 1. Preserve incident data
mkdir -p incidents/f1-failure-20260818
cp -r logs/app incidents/f1-failure-20260818/
cp grafana-export.json incidents/f1-failure-20260818/

# 2. Root cause analysis
# - Review error logs
# - Check monitoring alerts
# - Investigate database consistency
# - Review service logs

# 3. Fix implementation
# - Create fix PR
# - Code review
# - Test fix in staging

# 4. Schedule retry
# - Deploy fix to production
# - Prepare for Phase F-1 retry
# - Notify stakeholders
```

---

## Monitoring Resources

### Grafana Dashboards
- **Overview**: http://localhost:3000/d/tejoma-overview
- **Cutover Status**: http://localhost:3000/d/tejoma-cutover-status

### Prometheus
- **Targets**: http://localhost:9090/targets
- **Alerts**: http://localhost:9090/alerts

### Service Logs
```bash
# Monolith
docker logs app --tail=100 -f

# Individual services
docker logs matching-scoring-service -f
docker logs matching-reasoning-service -f
docker logs resume-service -f

# Or via kubectl
kubectl logs -f deployment/app -n tejoma
kubectl logs -f deployment/matching-scoring-service -n tejoma
```

### Database
```bash
# Active connections
psql -U postgres tejoma_recruiting -c \
  "SELECT usename, state, count(*) FROM pg_stat_activity GROUP BY 1,2;"

# Query performance
psql -U postgres tejoma_recruiting -c \
  "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

---

## Emergency Contacts

| Role | Name | Phone | Email | Escalation |
|------|------|-------|-------|------------|
| On-Call | [NAME] | [PHONE] | [EMAIL] | [MANAGER] |
| Ops Lead | [NAME] | [PHONE] | [EMAIL] | [DIRECTOR] |
| Database DBA | [NAME] | [PHONE] | [EMAIL] | [DEPT HEAD] |
| Infrastructure | [NAME] | [PHONE] | [EMAIL] | [VP] |

---

## Approval Sign-Off

**Deployment Authorized By**: _________________ Date: _______

**Infrastructure Lead**: _________________ Date: _______

**Database DBA**: _________________ Date: _______

**On-Call Team Lead**: _________________ Date: _______

---

*Ready to execute Phase F-1 Canary Deployment*  
*Status: ✅ APPROVED FOR DEPLOYMENT*
