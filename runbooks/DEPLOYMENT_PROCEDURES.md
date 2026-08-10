# Tejoma Deployment Procedures

## Phase-Based Deployment

### Phase 1: Canary Deployment (Week 1)

**Objective**: Deploy full microservices with 5% traffic, all cutover flags disabled

**Steps**:
1. Prepare k8s cluster (or Docker Swarm equivalent)
2. Create namespace: `kubectl create namespace tejoma`
3. Create secrets: `kubectl create secret generic tejoma-secrets ...`
4. Deploy with Phase 1 flags: `CUTOVER_PHASE=1 ./scripts/deploy.sh`
5. Verify deployment: `kubectl get pods -n tejoma`
6. Monitor metrics: Watch Grafana dashboard for 48 hours
7. **Go/No-Go Decision**: If stable, proceed to Phase 2

**Rollback if needed**: `kubectl rollout undo deployment/SERVICE_NAME -n tejoma`

### Phase 2: Gradual Cutover (Weeks 2-4)

**Week 2**: Enable career trajectories, 25% traffic
```bash
CUTOVER_PHASE=2 ./scripts/deploy.sh
# Monitor for 72 hours
# Watch: career trajectory creation, error rate, latency
```

**Week 3**: Enable reasoning conclusions, 50% traffic
```bash
CUTOVER_PHASE=3 ./scripts/deploy.sh
# Monitor for 72 hours
# Watch: reasoning conclusion writes, cache hit rates
```

**Week 4**: Enable RAG indexing, 100% traffic
```bash
CUTOVER_PHASE=4 ./scripts/deploy.sh
# Monitor for 168 hours (1 week)
# Watch: RAG index updates, chat query latency
```

### Phase 3: Monolith Deprecation (Week 5)

**Objective**: Monolith runs in read-only mode, services fully independent

**Steps**:
1. Scale monolith replicas to 1: `kubectl scale deployment/monolith --replicas=1 -n tejoma`
2. Enable read-only mode: Set env var `MONOLITH_READ_ONLY=true`
3. Monitor for 72 hours: Verify services don't depend on monolith writes
4. Check logs for any write attempts to monolith

### Phase 4: Decommission (Day 36+)

**Objective**: Remove monolith, archive database

**Steps**:
1. **Pre-decommission checks**:
   - Verify no monolith write operations in logs
   - Verify all services healthy for 48+ hours
   - Backup monolith database: `pg_dump tejoma_recruiting > backup.sql`
   - Store backup: Upload to S3 or secure storage

2. **Decommission**:
   - Scale monolith to 0: `kubectl scale deployment/monolith --replicas=0 -n tejoma`
   - Keep archived DB for 30 days (for emergency recovery)
   - Document decommission completion

3. **Post-decommission**:
   - Update runbooks (remove monolith references)
   - Update architecture docs
   - Celebrate! 🎉

---

## Service Deployment

### Deploying New Service

1. **Build image**: `docker build -t tejoma/SERVICE_NAME:VERSION .`
2. **Push to registry**: `docker push tejoma/SERVICE_NAME:VERSION`
3. **Update k8s manifest**: Edit `k8s/services/service-template.yaml`
4. **Deploy**: `CUTOVER_PHASE=CURRENT ./scripts/deploy.sh`
5. **Verify**: `kubectl get pods -n tejoma | grep SERVICE_NAME`

### Updating Existing Service

1. **Code changes**: Commit and merge to main
2. **Build new image**: `docker build -t tejoma/SERVICE_NAME:VERSION .`
3. **Push**: `docker push tejoma/SERVICE_NAME:VERSION`
4. **Update deployment**:
   ```bash
   kubectl set image deployment/SERVICE_NAME SERVICE_NAME=tejoma/SERVICE_NAME:VERSION -n tejoma
   ```
5. **Verify rollout**: `kubectl rollout status deployment/SERVICE_NAME -n tejoma`

### Rollback Service

```bash
# Show rollout history
kubectl rollout history deployment/SERVICE_NAME -n tejoma

# Rollback to previous version
kubectl rollout undo deployment/SERVICE_NAME -n tejoma

# Rollback to specific revision
kubectl rollout undo deployment/SERVICE_NAME --to-revision=2 -n tejoma

# Verify
kubectl rollout status deployment/SERVICE_NAME -n tejoma
```

---

## Cutover Flag Management

### Safely Enable a Cutover Flag

1. **Prepare**: Ensure service is healthy and tested
2. **Enable flag**: Edit ConfigMap and apply
3. **Restart pods**: Force pods to pick up new env vars
4. **Monitor**: Watch for errors for 30 min
5. **Disable if issues**: Immediately disable flag and restart pods

```bash
# Enable flag
kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"FLAG_NAME":"true"}}'

# Restart all pods to pick up change
kubectl rollout restart deployment --all -n tejoma

# Monitor
kubectl logs -f deployment/SERVICE_NAME -n tejoma

# Rollback if issues
kubectl patch configmap tejoma-config -n tejoma -p '{"data":{"FLAG_NAME":"false"}}'
kubectl rollout restart deployment --all -n tejoma
```

### Verify Flag Values

```bash
# Show all cutover flags
kubectl get configmap tejoma-config -n tejoma -o yaml | grep CUTOVER

# Verify all pods have same values
for pod in $(kubectl get pods -n tejoma -o name | grep -v monolith); do
  echo "=== $pod ==="
  kubectl exec $pod -n tejoma -- env | grep CUTOVER
done
```

---

## Disaster Recovery

### Complete Service Failure

**If entire cluster down**:
1. Start new cluster
2. Restore database from backup: `psql < backup.sql`
3. Deploy with all cutover flags disabled: `CUTOVER_PHASE=1 ./scripts/deploy.sh`
4. Verify monolith is functioning
5. Gradually re-enable cutover flags

**If only microservices down**:
1. Scale all services to 0: `kubectl scale deployment --all --replicas=0 -n tejoma`
2. Verify monolith is handling all traffic
3. Fix service issues (rebuild, update config, etc.)
4. Redeploy services: `CUTOVER_PHASE=CURRENT ./scripts/deploy.sh`

### Database Corruption

**If production database corrupted**:
1. Stop all writes: Disable all cutover flags
2. Restore from backup: `pg_restore -d tejoma_recruiting backup.dump`
3. Verify: Spot-check key records
4. Resume cutover flags

---

## Performance Tuning

### Scaling Services

```bash
# Scale specific service
kubectl scale deployment/SERVICE_NAME --replicas=5 -n tejoma

# Auto-scale based on CPU
kubectl autoscale deployment/SERVICE_NAME --min=2 --max=10 --cpu-percent=80 -n tejoma
```

### Adjusting Resource Limits

1. Edit k8s/services/service-template.yaml
2. Update memory/CPU limits
3. Redeploy: `./scripts/deploy.sh`
4. Monitor: `kubectl top pods -n tejoma`

### Caching Strategy

- Services should cache frequently-accessed data
- Use Redis for distributed cache
- Set appropriate TTLs (1-5 min for dynamic data)

---

## Verification Checklist

Before declaring deployment complete:

- [ ] All pods are running: `kubectl get pods -n tejoma`
- [ ] All services are healthy: Check liveness probes
- [ ] Metrics are flowing: Check Prometheus targets
- [ ] Alerts are not firing: Check Grafana
- [ ] Error rate < 0.1%: Check logs
- [ ] P99 latency < 500ms: Check metrics
- [ ] No cutover flag mismatches: Check ConfigMap
- [ ] Database connectivity verified: Test queries
- [ ] Backup exists and is recent: Verify restore works

---

## Monitoring During Deployment

Use Grafana dashboards:
1. **Overview**: Service health, request rate, error rate, latency
2. **Cutover Status**: Flag values, service-to-monolith call ratio
3. **Resource Usage**: Memory, CPU, disk
4. **Database**: Connection pools, query performance

Alert notifications should go to:
- Slack: #tejoma-incidents
- PagerDuty: Critical alerts
- Email: Weekly summary
