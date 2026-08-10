# Tejoma Incident Response Runbooks

## Quick Reference

**Escalation**: Page on-call engineer → Contact platform lead → Contact SRE team

**Common Commands**:
```bash
# Check service status
kubectl get pods -n tejoma -o wide

# View logs
kubectl logs -f deployment/SERVICE_NAME -n tejoma

# Check metrics
kubectl top pods -n tejoma

# Restart service
kubectl rollout restart deployment/SERVICE_NAME -n tejoma

# Immediate rollback (all cutover flags disabled)
kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"CAREER_TRAJECTORIES_CUTOVER_ENABLED":"false","REASONING_CONCLUSIONS_CUTOVER_ENABLED":"false","RAG_INDEXING_CUTOVER_ENABLED":"false"}}'
```

---

## Incident: Service is Down

**Severity**: CRITICAL
**Detection**: Prometheus alert "ServiceDown" fires
**SLA**: Acknowledge in 5 min, resolve in 15 min

### Diagnosis
```bash
# 1. Check if pod is running
kubectl get pods -n tejoma | grep SERVICE_NAME

# 2. Check pod status
kubectl describe pod POD_NAME -n tejoma

# 3. Check logs
kubectl logs -f deployment/SERVICE_NAME -n tejoma

# 4. Check health endpoint
kubectl port-forward svc/SERVICE_NAME 8080:8080 -n tejoma
curl http://localhost:8080/health
```

### Resolution

**If pod is crashing:**
1. Check logs for errors: `kubectl logs POD_NAME -n tejoma`
2. Check resource limits: `kubectl top pod POD_NAME -n tejoma`
3. If OOM: Scale up memory in k8s/services/service-template.yaml and redeploy
4. If CPU limit: Increase CPU limit and redeploy

**If pod is stuck:**
1. Delete pod to force restart: `kubectl delete pod POD_NAME -n tejoma`
2. Monitor logs: `kubectl logs -f deployment/SERVICE_NAME -n tejoma`
3. If still fails, escalate to platform lead

**If multiple services down:**
1. Check cluster health: `kubectl get nodes`
2. Check disk space: `df -h`
3. Check if monolith is healthy: `kubectl logs deployment/monolith -n tejoma`
4. If cluster unhealthy, escalate to SRE team

---

## Incident: High Error Rate (>5%)

**Severity**: HIGH
**Detection**: Prometheus alert "HighErrorRate" fires
**SLA**: Acknowledge in 10 min, begin recovery in 30 min

### Diagnosis
```bash
# 1. Check error distribution
kubectl logs -f deployment/SERVICE_NAME -n tejoma | grep "ERROR\|error\|Exception"

# 2. Check recent changes
git log --oneline -10

# 3. Check database connectivity
kubectl get secret tejoma-secrets -n tejoma -o yaml | grep db-password

# 4. Check dependent service health
kubectl get pods -n tejoma -o wide
```

### Resolution

**If errors from recent deployment:**
1. Check what changed: `git diff HEAD~1`
2. Rollback if possible: `kubectl rollout undo deployment/SERVICE_NAME -n tejoma`
3. If not rollback-able, fix the issue and redeploy

**If database errors:**
1. Check DB connectivity: `kubectl exec -it deployment/SERVICE_NAME -n tejoma -- nc -zv postgres.tejoma.svc.cluster.local 5432`
2. Check DB credentials: Verify DB_PASSWORD in secrets
3. Check DB logs: Depends on DB provider

**If dependency errors:**
1. Check dependency service health: `kubectl get pods SERVICE_DEP -n tejoma`
2. Check if using correct internal URL: `kubectl get configmap tejoma-config -n tejoma -o yaml | grep SERVICE_URL`
3. Restart dependent service: `kubectl rollout restart deployment/SERVICE_DEP -n tejoma`

**If monolith errors (cutover issue):**
1. Check cutover flags: `kubectl get configmap tejoma-config -n tejoma -o yaml | grep CUTOVER`
2. If flag mismatch, disable cutover: See "Rollback all cutover flags" section
3. Check monolith logs: `kubectl logs deployment/monolith -n tejoma`

---

## Incident: High Latency (P99 > 1s)

**Severity**: MEDIUM
**Detection**: Prometheus alert "HighLatency" fires
**SLA**: Acknowledge in 15 min, begin investigation in 45 min

### Diagnosis
```bash
# 1. Check which service is slow
kubectl logs -f deployment/SERVICE_NAME -n tejoma | grep "duration\|latency"

# 2. Check resource usage
kubectl top pods -n tejoma

# 3. Check database query performance
# (varies by DB provider - check slow query logs)

# 4. Check network connectivity
kubectl exec -it deployment/SERVICE_NAME -n tejoma -- ping DEPENDENCY_SERVICE.tejoma.svc.cluster.local
```

### Resolution

**If high CPU usage:**
1. Check what's consuming CPU: `kubectl top pods -n tejoma --containers`
2. Increase CPU limit in k8s/services/service-template.yaml
3. Redeploy: `CUTOVER_PHASE=CURRENT ./scripts/deploy.sh`

**If high memory usage:**
1. Check memory: `kubectl top pods -n tejoma`
2. If close to limit, increase memory in k8s/services/service-template.yaml
3. If memory keeps growing, investigate for memory leak in logs

**If database is slow:**
1. Check database stats: See DB provider docs
2. If query is slow, optimize query in code
3. Add indexes if missing
4. Revert recent schema changes if applicable

**If network is slow:**
1. Check node connectivity: `kubectl get nodes`
2. Check if nodes have network issues: `kubectl describe node NODE_NAME`
3. Escalate to SRE team

---

## Incident: Cutover Flag Mismatch

**Severity**: CRITICAL
**Detection**: Prometheus alert "CutoverFlagMismatch" fires
**SLA**: Acknowledge in 5 min, resolve in 10 min

### Diagnosis
```bash
# Check all cutover flags
kubectl get configmap tejoma-config -n tejoma -o yaml | grep CUTOVER

# Check which pods have which values
kubectl get pods -n tejoma -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].env[?(@.name=="CAREER_TRAJECTORIES_CUTOVER_ENABLED")].value}{"\n"}{end}'
```

### Resolution

1. **Identify mismatch**: Note which flags differ
2. **Correct the ConfigMap**: 
   ```bash
   kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"CAREER_TRAJECTORIES_CUTOVER_ENABLED":"VALUE","REASONING_CONCLUSIONS_CUTOVER_ENABLED":"VALUE","RAG_INDEXING_CUTOVER_ENABLED":"VALUE"}}'
   ```
3. **Restart all pods** to pick up new config:
   ```bash
   kubectl rollout restart deployment --all -n tejoma
   ```
4. **Verify flags are consistent**: Re-run diagnosis above

---

## Incident: Database Connection Pool Exhaustion

**Severity**: HIGH
**Detection**: Prometheus alert "DBConnectionPoolNearExhaustion" fires
**SLA**: Acknowledge in 10 min, resolve in 30 min

### Diagnosis
```bash
# Check which service is exhausted
kubectl logs deployment/SERVICE_NAME -n tejoma | grep "connection pool\|exhausted"

# Check active connections
kubectl exec -it deployment/SERVICE_NAME -n tejoma -- curl localhost:3006/api/metrics | grep db_pool
```

### Resolution

**If specific service:**
1. Check if service has memory leak: `kubectl top deployment/SERVICE_NAME -n tejoma`
2. Check if connections not being released: Review recent code changes
3. Increase pool size in service code: Typically in `src/db.ts`
4. Redeploy service

**If all services:**
1. Check if database is unhealthy: `kubectl exec -it deployment/monolith -n tejoma -- nc -zv postgres.tejoma.svc.cluster.local 5432`
2. Check database connection limits: Depends on DB provider
3. If DB limit hit, scale up DB resources or reduce pool size in services

---

## Incident: Monolith Fallback Loop

**Severity**: CRITICAL
**Detection**: Error logs show repeated fallback to monolith
**SLA**: Acknowledge in 5 min, resolve in 15 min

### Diagnosis
```bash
# Check if any service is calling monolith too frequently
kubectl logs -f deployment/SERVICE_NAME -n tejoma | grep "monolith\|fallback"

# Check monolith is healthy
kubectl get pod -l app=monolith -n tejoma
kubectl logs deployment/monolith -n tejoma
```

### Resolution

1. **Disable cutover flags** to force monolith usage while investigating:
   ```bash
   kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"CAREER_TRAJECTORIES_CUTOVER_ENABLED":"false","REASONING_CONCLUSIONS_CUTOVER_ENABLED":"false","RAG_INDEXING_CUTOVER_ENABLED":"false"}}'
   kubectl rollout restart deployment --all -n tejoma
   ```

2. **Investigate why service is failing**:
   - Check logs: `kubectl logs deployment/SERVICE_NAME -n tejoma`
   - Check if service dependency is healthy
   - Check if service has correct environment config

3. **Fix the issue** (varies by root cause)

4. **Re-enable cutover flags** once fixed

---

## Rollback Procedures

### Rollback Single Cutover Flag
```bash
# Example: Disable career trajectories cutover
kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"CAREER_TRAJECTORIES_CUTOVER_ENABLED":"false"}}'
kubectl rollout restart deployment --all -n tejoma
```

### Rollback All Cutover Flags
```bash
# Return to 100% monolith fallback
kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"CAREER_TRAJECTORIES_CUTOVER_ENABLED":"false","REASONING_CONCLUSIONS_CUTOVER_ENABLED":"false","RAG_INDEXING_CUTOVER_ENABLED":"false"}}'
kubectl rollout restart deployment --all -n tejoma
```

### Rollback Service Deployment
```bash
# Return to previous version
kubectl rollout undo deployment/SERVICE_NAME -n tejoma

# Check rollback status
kubectl rollout status deployment/SERVICE_NAME -n tejoma
```

---

## On-Call Responsibilities

- **Response time**: Acknowledge alert within 5 min (critical) or 15 min (high)
- **Investigation**: Begin investigation within 30 min of alert
- **Communication**: Update Slack channel every 15 min
- **Escalation**: Contact platform lead if cannot resolve in 1 hour
- **Post-incident**: File incident report and schedule retrospective

---

## Useful Links

- Grafana Dashboard: http://grafana.tejoma.svc.cluster.local:3000
- Prometheus: http://prometheus.tejoma.svc.cluster.local:9090
- Kubernetes Dashboard: kubectl proxy then http://localhost:8001/
- PagerDuty: [link to PagerDuty]
- Incident Slack Channel: #tejoma-incidents
