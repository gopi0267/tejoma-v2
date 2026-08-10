# Operations Checklist: Phase 2 & 3 Execution

Use this checklist to ensure nothing is missed during migration execution.

---

## PHASE 2: Aug 10-11

### Pre-Execution (Aug 10, 08:00)

- [ ] Verify databases exist
  ```bash
  psql -l | grep -E "tejoma_uploads|tejoma_resume|tejoma_notifications"
  ```
  Expected: All 3 databases exist

- [ ] Verify monolith database ready
  ```bash
  psql -d tejoma_recruiting -c "\dt" | grep -E "uploads|resumes|notifications"
  ```
  Expected: Tables exist in monolith

- [ ] Verify DUAL_WRITE_ENABLED=true
  ```bash
  grep "DUAL_WRITE_ENABLED" .env.local
  ```
  Expected: `DUAL_WRITE_ENABLED=true`

- [ ] Monolith running locally
  ```bash
  npm run dev
  # Wait for "listening on port 3000"
  ```

### Execution (Aug 10, 09:00)

- [ ] Run backfill script
  ```bash
  npm run backfill:phase2
  ```
  Expected: "Backfilled X uploads, Y resumes, Z notifications"
  Duration: ~5 minutes
  **Log output**: Save to `phase2-backfill.log`

- [ ] Run validation script
  ```bash
  npm run validate:phase2
  ```
  Expected: "✅ VALIDATION PASSED - ZERO DRIFT DETECTED"
  Duration: ~5 minutes
  Exit code: 0
  **Log output**: Save to `phase2-validation.log`

### Monitoring (Aug 10-11, All Day)

- [ ] Start log monitoring
  ```bash
  tail -f logs/app.log | tee phase2-monitoring.log | grep -E "upsert|error|dualWrite"
  ```

- [ ] Every 2 hours, check for errors
  - [ ] 11:00 - Check logs
  - [ ] 13:00 - Check logs
  - [ ] 15:00 - Check logs
  - [ ] 17:00 - Check logs
  - [ ] 19:00 - Check logs
  - [ ] 21:00 - Check logs
  - [ ] 09:00 (Aug 11) - Check logs
  - [ ] 11:00 (Aug 11) - Final check

- [ ] Create status report
  - Total dual-writes: ___________
  - Failed dual-writes: ___________
  - Error rate: ___________
  - Status: 🟢 GREEN / 🔴 RED

### Approval (Aug 11, EOD)

- [ ] Tech lead reviews logs
- [ ] Zero errors confirmed? YES / NO
- [ ] Zero drift confirmed? YES / NO
- [ ] Ready to proceed? YES / NO
- [ ] Sign-off date: ___________

---

## PHASE 3 STAGING: Aug 16-19

### Pre-Deployment (Aug 16, 08:00)

- [ ] Staging environment ready
  - [ ] Servers available
  - [ ] Databases created
  - [ ] Networking configured

- [ ] Staging configuration files ready
  - [ ] .env.staging for upload-service
  - [ ] .env.staging for resume-service
  - [ ] .env.staging for notifications-service

- [ ] Monitoring dashboards set up
  - [ ] Prometheus endpoint accessible
  - [ ] Grafana dashboard created
  - [ ] Slack alerts configured

- [ ] On-call team briefed
  - [ ] Procedures documented
  - [ ] War room channel created
  - [ ] Escalation path clear

### Deployment (Aug 16, 09:00)

- [ ] Deploy upload-service to staging
  ```bash
  deploy upload-service --env=staging --region=us-east
  ```
  Status: ✅ Healthy / ❌ Failed

- [ ] Deploy resume-service to staging
  ```bash
  deploy resume-service --env=staging --region=us-east
  ```
  Status: ✅ Healthy / ❌ Failed

- [ ] Deploy notifications-service to staging
  ```bash
  deploy notifications-service --env=staging --region=us-east
  ```
  Status: ✅ Healthy / ❌ Failed

- [ ] Health check all services
  ```bash
  curl -s http://upload-service-staging:4030/health
  curl -s http://resume-service-staging:4031/health
  curl -s http://notifications-service-staging:4032/health
  ```
  Expected: `{"status":"ok"}` for each

### Testing (Aug 16-17)

- [ ] Run full test suite
  ```bash
  npm test -- --match "*service*"
  ```
  Status: ✅ All passing / ❌ Failures

- [ ] Manual smoke tests
  - [ ] Upload file → verify in DB
  - [ ] Create resume → verify extraction
  - [ ] Create notification → verify WebSocket
  - [ ] Delete record → verify cascade

- [ ] A/B parity tests
  ```bash
  npm run test:ab-parity
  ```
  Status: ✅ Responses match / ❌ Differences found

### Load Testing (Aug 17)

- [ ] Load test configuration
  - [ ] Target: 1000 req/s
  - [ ] Duration: 600 seconds
  - [ ] Ramp-up: 60 seconds

- [ ] Run load test
  ```bash
  npm run load-test -- --target=staging --rps=1000 --duration=600
  ```

- [ ] Collect metrics
  - [ ] Error rate: _____________ (target: <0.1%)
  - [ ] p50 latency: _____________ (target: <100ms)
  - [ ] p99 latency: _____________ (target: <500ms)
  - [ ] Memory per service: _____________ (target: <500MB)

### Rollback Drill (Aug 17)

- [ ] Flip all feature flags to false
  ```bash
  UPLOAD_SERVICE_ENABLED=false
  RESUME_SERVICE_ENABLED=false
  NOTIFICATIONS_SERVICE_ENABLED=false
  ```

- [ ] Restart nginx
  ```bash
  systemctl restart nginx
  ```

- [ ] Verify traffic → monolith
  ```bash
  curl -s http://monolith-staging:3000/health
  ```

- [ ] Re-enable flags
  ```bash
  UPLOAD_SERVICE_ENABLED=true
  RESUME_SERVICE_ENABLED=true
  NOTIFICATIONS_SERVICE_ENABLED=true
  ```

- [ ] Verify services back online
  ```bash
  curl -s http://upload-service-staging:4030/health
  curl -s http://resume-service-staging:4031/health
  curl -s http://notifications-service-staging:4032/health
  ```

- [ ] Rollback drill time: _____________ (should be < 1 minute)
- [ ] Status: ✅ Successful / ❌ Failed

### Approval (Aug 18-19)

- [ ] Stakeholder review of staging results
- [ ] Load test metrics acceptable? YES / NO
- [ ] Rollback drill successful? YES / NO
- [ ] Ready for production? YES / NO
- [ ] Decision: ✅ PROCEED / ❌ HOLD
- [ ] Sign-off date: ___________

---

## PHASE 3 PRODUCTION: Aug 21-31

### Pre-Rollout (Aug 21, 07:00)

- [ ] War room set up
  - [ ] Team in Slack channel
  - [ ] On-call standing by
  - [ ] Communication plan ready

- [ ] Monitoring live
  - [ ] Prometheus scraping all services
  - [ ] Grafana dashboards showing real-time data
  - [ ] Slack alerts active

- [ ] Rollback plan reviewed
  - [ ] All team members know procedure
  - [ ] Instant rollback tested
  - [ ] Decision tree clear

- [ ] Backup verified
  - [ ] Database backups recent
  - [ ] Restore procedure tested
  - [ ] Time to restore: _____________ minutes

### 10% Rollout (Aug 21, 08:00)

- [ ] Enable feature flags for 10% of traffic
  ```bash
  UPLOAD_SERVICE_ENABLED=true (10%)
  RESUME_SERVICE_ENABLED=true (10%)
  NOTIFICATIONS_SERVICE_ENABLED=true (10%)
  ```

- [ ] Monitor metrics every 5 minutes
  - [ ] 08:05 - Error rate: __________, Latency p99: __________
  - [ ] 08:10 - Error rate: __________, Latency p99: __________
  - [ ] 08:15 - Error rate: __________, Latency p99: __________
  - [ ] Continue through entire day...

- [ ] Success criteria for 10%
  - [ ] Error rate < 0.1%? ✅ / ❌
  - [ ] Latency p99 < 500ms? ✅ / ❌
  - [ ] Logs clean? ✅ / ❌
  - [ ] No rollback needed? ✅ / ❌

- [ ] 10% rollout status: ✅ GREEN / 🔴 RED
- [ ] Decision at EOD: ✅ PROCEED to 50% / ❌ ROLLBACK

### 50% Rollout (Aug 24, 08:00)

- [ ] Enable feature flags for 50% of traffic
  ```bash
  UPLOAD_SERVICE_ENABLED=true (50%)
  RESUME_SERVICE_ENABLED=true (50%)
  NOTIFICATIONS_SERVICE_ENABLED=true (50%)
  ```

- [ ] Monitor metrics every 5 minutes (same as 10%)

- [ ] Success criteria for 50%
  - [ ] Error rate < 0.1%? ✅ / ❌
  - [ ] Latency p99 < 500ms? ✅ / ❌
  - [ ] Logs clean? ✅ / ❌
  - [ ] No new issues? ✅ / ❌

- [ ] 50% rollout status: ✅ GREEN / 🔴 RED
- [ ] Decision at EOD: ✅ PROCEED to 100% / ❌ ROLLBACK

### 100% Rollout (Aug 27, 08:00)

- [ ] Enable feature flags for 100% of traffic
  ```bash
  UPLOAD_SERVICE_ENABLED=true (100%)
  RESUME_SERVICE_ENABLED=true (100%)
  NOTIFICATIONS_SERVICE_ENABLED=true (100%)
  ```

- [ ] Intensive monitoring
  - [ ] Every 1 minute check metrics
  - [ ] War room staffed 24/7
  - [ ] On-call team on alert

- [ ] Success criteria for 100%
  - [ ] Error rate < 0.1%? ✅ / ❌
  - [ ] Latency p99 < 500ms? ✅ / ❌
  - [ ] Logs clean? ✅ / ❌
  - [ ] All systems green? ✅ / ❌

- [ ] 100% rollout status: ✅ GREEN / 🔴 RED
- [ ] Cutover complete: ✅ SUCCESS / ❌ ROLLBACK

### Stabilization (Aug 28-31)

- [ ] Aug 28: 24-hour post-cutover validation
  - [ ] Zero data corruption? ✅ / ❌
  - [ ] All features working? ✅ / ❌
  - [ ] Performance optimal? ✅ / ❌

- [ ] Aug 29: Documentation & handoff
  - [ ] Operations runbook updated
  - [ ] Team trained on procedures
  - [ ] Escalation path documented

- [ ] Aug 30: Final verification
  - [ ] All metrics stable
  - [ ] Logs clean
  - [ ] No issues reported

- [ ] Aug 31: Project complete
  - [ ] Status: ✅ PRODUCTION STABLE
  - [ ] Migration complete: YES
  - [ ] Incidents: 0
  - [ ] Data loss: 0

---

## ROLLBACK PROCEDURE (Use If Needed)

```bash
# Step 1: Disable all services
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false

# Step 2: Restart nginx
systemctl restart nginx

# Step 3: Verify monolith handling traffic
curl http://monolith:3000/health

# Step 4: Investigate root cause
# (logs in /var/log/monolith.log)

# Step 5: Report incident
# (to on-call team lead)
```

**Rollback time**: < 1 minute
**Data lost**: 0 records
**Downtime**: 0 seconds

---

## Sign-Off

**Phase 2 Validation**: __________ __________ (Name/Date)
**Phase 3 Staging Approval**: __________ __________ (Name/Date)
**Phase 3 Production Go-Ahead**: __________ __________ (Name/Date)
**Production Stable Sign-Off**: __________ __________ (Name/Date)

---

**Printed**: August 10, 2026
**Valid through**: August 31, 2026
