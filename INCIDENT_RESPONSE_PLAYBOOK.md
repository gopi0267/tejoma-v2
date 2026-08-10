# Incident Response Playbook: Phase 2 & 3

**Last updated**: August 10, 2026
**Relevant phases**: Phase 2 (Aug 10-11) and Phase 3 (Aug 16-31)

---

## Quick Reference: When Something Goes Wrong

### Instant Rollback (Works Every Time)

```bash
# At ANY point during Phase 2-3, if you see issues:
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false

# Result: All traffic routes to monolith immediately
# Recovery time: < 1 minute
# Data loss: 0 records (always wrote to monolith too)
```

---

## Phase 2 Incidents (Aug 10-11)

### Symptom: Backfill Script Fails

**Error message in console**: `Error: Cannot connect to tejoma_uploads`

**Root cause investigation**:
1. Check database exists
   ```bash
   psql -l | grep tejoma_uploads
   ```
   Expected: Shows database listed

2. Check database is accessible
   ```bash
   psql -d tejoma_uploads -c "SELECT 1"
   ```
   Expected: Returns `1`

3. Check migrations ran
   ```bash
   psql -d tejoma_uploads -c "\dt"
   ```
   Expected: Shows `uploads`, `resume_extraction_jobs`, `notifications` tables

**Fix**:
- If database doesn't exist: `npm run migrate:phase1` (creates all 3 service databases)
- If migrations haven't run: `npm run migrate:phase1` again
- If still failing: Check .env.local for DB_HOST, DB_PORT, DB_USER, DB_PASSWORD

**Verify fix**:
```bash
npm run backfill:phase2  # Should complete without errors
```

---

### Symptom: Validation Script Shows Drift

**Error message**: `❌ VALIDATION FAILED - DRIFT DETECTED`

**What this means**: Monolith and service databases don't match. Could be:
- Data loaded to wrong database
- Recent writes to monolith after backfill
- Bug in dual-write code

**Root cause investigation**:
1. Check which table has drift
   ```bash
   # Look at validation script output for specific table
   # Example: "Notification counts don't match: 1500 in monolith, 1499 in service"
   ```

2. Count rows in both databases
   ```bash
   # Monolith
   psql -d tejoma_recruiting -c "SELECT COUNT(*) FROM notifications"
   
   # Service
   psql -d tejoma_notifications -c "SELECT COUNT(*) FROM notifications"
   ```

3. If counts don't match, check recent writes
   ```bash
   # Last 10 notifications in monolith
   psql -d tejoma_recruiting -c "SELECT id, created_at FROM notifications ORDER BY created_at DESC LIMIT 10"
   
   # Last 10 in service
   psql -d tejoma_notifications -c "SELECT id, created_at FROM notifications ORDER BY created_at DESC LIMIT 10"
   ```

**Fix options**:

**Option 1 (Recommended): Rerun backfill**
```bash
# Backfill is idempotent (safe to run multiple times)
npm run backfill:phase2

# Then validate again
npm run validate:phase2
```

**Option 2 (If Option 1 doesn't work): Disable dual-write temporarily**
```bash
# In .env.local
DUAL_WRITE_ENABLED=false

# Investigate logs
tail -f logs/app.log | grep -E "upsert|error"

# Once you understand the issue, re-enable
DUAL_WRITE_ENABLED=true

# Rerun backfill
npm run backfill:phase2

# Rerun validation
npm run validate:phase2
```

**Verify fix**:
```bash
npm run validate:phase2
# Should output: ✅ VALIDATION PASSED - ZERO DRIFT DETECTED
```

---

### Symptom: Dual-Write Errors in Logs

**Error message**: `[ERROR] dualWrite upsertNotification failed: Connection timeout`

**What this means**: Services are running, but can't reach them in time. Usually:
- Service crashed
- Network connectivity issue
- Service too slow

**Root cause investigation**:
1. Check if services are running
   ```bash
   curl -s http://localhost:4030/health  # Upload service
   curl -s http://localhost:4031/health  # Resume service
   curl -s http://localhost:4032/health  # Notifications service
   ```
   Expected: All respond with `{"status":"ok"}`

2. Check service logs
   ```bash
   docker logs upload-service
   docker logs resume-service
   docker logs notifications-service
   ```

3. Check network connectivity
   ```bash
   ping -c 1 localhost:4030
   ```

**Fix**:

**If services crashed**:
```bash
# Restart all services
docker-compose restart upload-service resume-service notifications-service

# Verify they're back up
curl -s http://localhost:4030/health
```

**If network issue**:
- Check Docker networking: `docker network ls`
- Check service ports are exposed: `docker ps`
- Verify .env URLs are correct: `UPLOAD_SERVICE_URL=http://localhost:4030` etc.

**If service too slow**:
- Check service logs for performance issues
- May need to increase timeout from 5 seconds
- Last resort: Disable dual-write temporarily, fix service, re-enable

**Verify fix**:
```bash
# Watch logs should show no more errors
tail -f logs/app.log | grep -E "dualWrite.*error"
# Should be silent (no errors)
```

---

## Phase 3 Staging Incidents (Aug 16-19)

### Symptom: Service Fails to Deploy to Staging

**Error**: Deployment command times out or returns error code

**Root cause investigation**:
1. Check staging environment is ready
   ```bash
   # Can you SSH to staging?
   ssh staging-server-1
   
   # Is Docker available?
   docker ps
   ```

2. Check service image exists
   ```bash
   docker image ls | grep upload-service
   docker image ls | grep resume-service
   docker image ls | grep notifications-service
   ```

3. Check staging configuration
   ```bash
   # Verify .env.staging files exist for each service
   ls -la upload-service/.env.staging
   ```

**Fix**:
- If Docker not available: Install Docker on staging servers
- If images don't exist: Build locally, push to registry, or build on staging
- If .env.staging missing: Copy from .env.example and fill in staging values
- If deployment command failing: Check deployment script for syntax errors

**Verify fix**:
```bash
# After deployment, health check
curl -s http://upload-service-staging:4030/health
curl -s http://resume-service-staging:4031/health
curl -s http://notifications-service-staging:4032/health
# All should return {"status":"ok"}
```

---

### Symptom: Tests Failing in Staging

**Error**: `npm test` fails with "X tests failed"

**Root cause investigation**:
1. Check test output for which test failed
2. Common causes:
   - Database not initialized (missing migrations)
   - Environment variables not set correctly
   - Data fixtures outdated
   - Service dependencies not running

**Fix**:
```bash
# 1. Make sure all services running
docker-compose ps

# 2. Run migrations
npm run migrate

# 3. Seed test data
npm run seed:test

# 4. Run tests again
npm test
```

**Verify fix**:
```bash
npm test -- --match "*" 2>&1 | tail -20
# Should show "All tests passed"
```

---

### Symptom: Load Test Shows High Error Rate

**Error**: "Error rate: 5.2% (expected <0.1%)"

**What this means**: Services can't handle load of 1000 req/s. Could be:
- Service OOM (out of memory)
- Database connection pool exhausted
- Network bottleneck
- Query performance degradation

**Root cause investigation**:
1. Check service metrics during load test
   ```bash
   # In another terminal, watch metrics
   docker stats upload-service resume-service notifications-service
   ```

2. Check service logs for errors
   ```bash
   docker logs -f upload-service | grep -i error
   ```

3. Check database query performance
   ```bash
   psql -d tejoma_uploads -c "SELECT query, calls, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 5"
   ```

**Fix**:

**If OOM**:
- Increase container memory limits in docker-compose.yml
- `memory: 1G` for each service (current: 512M)

**If connection pool exhausted**:
- Increase pool size in `config/env.ts` (currently 10, try 20)
- Or reduce timeout to fail faster: `REQUEST_TIMEOUT=3000` (currently 5000)

**If slow queries**:
- Add index: `CREATE INDEX idx_uploads_status ON uploads(upload_status)`
- Or reduce batch size in backfill scripts

**Retry load test**:
```bash
npm run load-test -- --target=staging --rps=1000 --duration=600
```

**Verify fix**:
- Error rate < 0.1%
- p99 latency < 500ms
- Services not hitting memory limits

---

### Symptom: Rollback Drill Fails

**Error**: "Traffic still routing to services after disabling flags"

**Root cause investigation**:
1. Verify flags were actually flipped
   ```bash
   grep "UPLOAD_SERVICE_ENABLED" .env.staging
   # Should show: UPLOAD_SERVICE_ENABLED=false
   ```

2. Verify nginx restarted
   ```bash
   systemctl status nginx
   ```

3. Check nginx config reload
   ```bash
   nginx -t  # Syntax check
   systemctl restart nginx
   ```

**Fix**:
```bash
# Step 1: Double-check flags in .env
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false

# Step 2: Reload nginx
systemctl reload nginx

# Step 3: Verify routing
curl -s http://staging-gateway:80/health
# Should route to monolith (port 3000)
```

**Verify fix**:
```bash
# Monitor nginx logs
tail -f /var/log/nginx/access.log | grep "POST /api/uploads"
# Should show requests going to monolith (not 4030)
```

---

## Phase 3 Production Incidents (Aug 21-28)

### Symptom: 10% Rollout Shows >0.1% Error Rate

**Error rate in dashboard**: 0.5% errors (expected <0.1%)

**This is a STOP signal** - Do NOT proceed to 50%

**Immediate action**:
```bash
# ROLLBACK INSTANTLY
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false

# Report to on-call team lead
# (use template below under "Team Communication")
```

**Root cause investigation** (while traffic is back on monolith):
1. Check production service logs
   ```bash
   # SSH to production server
   ssh prod-server-1
   
   # Stream logs
   journalctl -u upload-service -f | grep -i error
   journalctl -u resume-service -f | grep -i error
   journalctl -u notifications-service -f | grep -i error
   ```

2. Check error patterns
   - Are all 3 services erroring equally?
   - Is there a specific endpoint failing?
   - Are errors intermittent or constant?

3. Check monitoring dashboard
   - Memory spikes?
   - CPU spikes?
   - Database connection issues?

**Fix** (examples):
- **OOM**: Increase memory allocation, restart service
- **Slow queries**: Run query plan analysis, add indexes
- **Connection pool**: Increase pool size or lower timeout
- **Misconfiguration**: Check .env in production vs staging

**Re-enable** (after fix verified in staging):
```bash
# Step 1: Deploy fix to production
deploy-service upload-service --region=us-east

# Step 2: Run health check
curl -s http://prod-upload:4030/health

# Step 3: Re-enable flags at 1% (not 10%)
UPLOAD_SERVICE_ENABLED=true (1% traffic)

# Step 4: Monitor closely
watch -n 5 'curl -s http://prod-gateway/metrics | grep upload_service_errors'

# Step 5: After 1 hour stable, increase to 5%, then 10%
```

---

### Symptom: 50% Rollout Shows New Edge Case Error

**Error type**: "Unexpected null in response" (not seen in 10%)

**This is a CONDITIONAL STOP** - Investigate before rolling back

**Root cause investigation**:
1. Identify the edge case
   ```bash
   # Look at error messages
   grep "Unexpected null" /var/log/app.log | head -5
   
   # Find the request that caused it
   grep "request-id=abc123" /var/log/app.log
   ```

2. Reproduce locally
   - Find a production candidate that triggers the error
   - Test same candidate in staging
   - See if error reproduces

**Fix options**:

**Option A (Safe): Rollback**
```bash
# If you can't reproduce, rollback to 10%
UPLOAD_SERVICE_ENABLED=true (10% traffic)
RESUME_SERVICE_ENABLED=true (10% traffic)
NOTIFICATIONS_SERVICE_ENABLED=true (10% traffic)

# Investigate the edge case
# Fix in service code
# Redeploy
# Resume rollout from 10%
```

**Option B (If fix is quick): Fix and retry**
```bash
# If you can quickly fix (< 30 minutes):
# 1. Deploy fix to production
deploy-service matching-decision-service --region=us-east

# 2. Run smoke test
# 3. Keep 50% running (no rollback)
# 4. Monitor
```

---

### Symptom: 100% Rollout, Monolith Getting Spammed with Errors

**Scenario**: You flipped all flags to 100%, but see errors in monolith logs (shouldn't happen)

**This is a BUG** - The monolith should be idle during 100%, not getting traffic

**Immediate action**:
```bash
# ROLLBACK to 50% instantly
UPLOAD_SERVICE_ENABLED=true (50% traffic)
RESUME_SERVICE_ENABLED=true (50% traffic)
NOTIFICATIONS_SERVICE_ENABLED=true (50% traffic)

# Double-check: monolith logs should drop to silence
tail -f /var/log/monolith.log | grep -i upload
# Should be silent
```

**Root cause investigation**:
1. Check nginx config
   ```bash
   grep "UPLOAD_SERVICE_ENABLED\|proxy_pass" /etc/nginx/nginx.conf
   ```
   - Are feature flags wired up correctly?
   - Is fallback to monolith broken?

2. Check gateway code
   ```bash
   # Look at api-gateway/routes.ts or similar
   # Verify conditional routing logic
   ```

**Fix**:
- Re-review the gateway routing code
- Run A/B parity test in staging to confirm routing is correct
- Once confirmed in staging, re-attempt 100% in production

---

## Monitoring Thresholds & Alerting

### When to Escalate (Automatic Alerts)

**Critical** (Escalate immediately):
- Error rate > 1% for > 5 minutes
- Latency p99 > 2000ms for > 5 minutes
- Memory usage > 90% for > 2 minutes
- Database connection pool > 80% capacity
- Service responding with 5xx for > 1 minute

**Warning** (Monitor closely, alert team lead):
- Error rate > 0.1% for > 10 minutes
- Latency p99 > 500ms for > 10 minutes
- Memory usage > 75% for > 5 minutes
- Disk usage > 85%

**Info** (Log for analysis):
- Error rate 0-0.1%
- Latency p99 100-500ms
- Memory 50-75%
- Normal operational metrics

### Manual Check Frequency

**Phase 2 (Aug 10-11)**:
- Every 2 hours during waking hours
- Once before bed
- First thing in morning

**Phase 3 Staging (Aug 16-19)**:
- Every 1 hour during testing
- Continuous during load test
- Continuous during rollback drill

**Phase 3 Production**:
- **10% rollout (Aug 21-23)**: Every 5 minutes during hours 1-6, every 10 minutes thereafter
- **50% rollout (Aug 24-26)**: Every 15 minutes, then daily checks
- **100% rollout (Aug 27-28)**: Continuous monitoring (on-call standing by)
- **Stabilization (Aug 29-31)**: Daily checks

---

## Escalation Chain

**For Phase 2-3 Incidents**:

1. **First Alert** (You)
   - See the error
   - Check root cause (5 min)
   - If obvious fix, apply it
   - If not obvious, escalate

2. **Escalate to On-Call Engineer** (if not fixed in 5 min)
   - Message: "Phase X incident: [brief description]"
   - Provide: Error message, timestamp, affected service
   - Provide: Last 50 lines of logs
   - Provide: Current metrics dashboard screenshot

3. **Escalate to Tech Lead** (if not fixed in 15 min)
   - Provide all info from step 2
   - Provide: Attempted fixes and results
   - Recommendation: Rollback now vs. continue investigating
   - Tech lead makes rollback decision

4. **Decision Point** (At 20 min mark)
   - If not fixed: ROLLBACK (always safer)
   - Set feature flags to false
   - Verify traffic routes to monolith
   - Report status to stakeholders

---

## Post-Incident Review

After any rollback or extended troubleshooting:

1. **Document what happened** (within 24 hours)
   ```
   Incident: [Title]
   Date/Time: [When]
   Duration: [How long]
   Affected service: [Which]
   Error rate: [Severity]
   Root cause: [What we found]
   Fix applied: [What we changed]
   Prevention: [What we'll do to prevent]
   ```

2. **Update runbooks**
   - Add the error pattern to this playbook
   - Add the fix procedure
   - Add monitoring threshold if needed

3. **Brief team**
   - 15 min debrief with on-call engineer + tech lead
   - What we learned
   - What changed in procedures

4. **Monitor for 48 hours**
   - Watch for similar errors
   - Confirm fix is stable
   - Move forward only if confirmed

---

## Never Do This

❌ **DO NOT** push force to production without testing in staging
❌ **DO NOT** modify database schema without backup/restore plan
❌ **DO NOT** ignore drift validation (if validation fails, fix it, don't force forward)
❌ **DO NOT** keep services down for > 1 minute (rollback and investigate separately)
❌ **DO NOT** modify feature flags without logging the change
❌ **DO NOT** skip rollback drill in staging

---

## Always Do This

✅ **DO** run backfill before validation
✅ **DO** run validation before enabling shadow mode
✅ **DO** enable shadow mode before cutover
✅ **DO** start monitoring before each phase
✅ **DO** have rollback flags ready to flip
✅ **DO** test rollback before production
✅ **DO** document every change
✅ **DO** escalate early if unsure

---

**Questions during an incident?**

Call or message the on-call engineer immediately. Don't wait. The cost of recovery (<1 min) is far less than the cost of spreading a bad state.

**After incident is resolved**: Update this playbook with the new pattern.
