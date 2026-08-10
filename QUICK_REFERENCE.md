# Quick Reference Card - Phase 2 & 3 Execution

**Print this page. Keep it visible during all phases.**

---

## Phase 2: Aug 10-11 (Backfill & Validation)

### Commands to Run

```bash
# Step 1: Backfill all data (5 min)
npm run backfill:phase2

# Expected: "✅ Backfilled 0 uploads, 0 resumes, ~1500 notifications"

# Step 2: Validate zero drift (5 min)
npm run validate:phase2

# Expected: "✅ VALIDATION PASSED - ZERO DRIFT DETECTED"

# Step 3: Monitor for 24h
tail -f logs/app.log | grep -E "upsert|error"

# Expected: Silence or "✓ upsert successful" messages
```

### Success Criteria

✅ Backfill completes (shows counts)
✅ Validation passes (ZERO DRIFT)
✅ No errors in 24h logs
✅ Feature flags ready

### Failure Triggers

❌ Backfill fails → Check DB connectivity
❌ Validation shows drift → Rerun backfill
❌ Errors in logs → Check service health
❌ Validation false → Investigate, don't proceed

### Rollback Command

```bash
DUAL_WRITE_ENABLED=false
```

---

## Phase 3 Staging: Aug 16-19 (Testing)

### Daily Checklist

| Date | Task | Status |
|------|------|--------|
| Aug 16 | Deploy to staging | ☐ |
| Aug 16 | Run smoke tests | ☐ |
| Aug 16 | A/B parity tests | ☐ |
| Aug 17 | Load test 1000 req/s | ☐ |
| Aug 17 | Rollback drill | ☐ |
| Aug 18-19 | Get stakeholder sign-off | ☐ |

### Success Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Error rate | <0.1% | _____ |
| Latency p99 | <500ms | _____ |
| Memory | <500MB | _____ |
| Rollback time | <1 min | _____ |

### Rollback Command

```bash
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
```

---

## Phase 3 Production: Aug 21-28 (Rollout)

### Timeline

| Phase | Dates | Traffic | Status |
|-------|-------|---------|--------|
| 10% | Aug 21-23 | 10% | ☐ |
| 50% | Aug 24-26 | 50% | ☐ |
| 100% | Aug 27-28 | 100% | ☐ |

### Metrics to Monitor Every 5 Minutes

```
Error rate:    [____]%  (target: <0.1%)
Latency p99:   [____]ms (target: <500ms)
Memory:        [____]MB (target: <500MB)
Logs clean?    [  ]YES [  ]NO
```

### Decision Tree at Each Phase

```
Metrics all green? (error <0.1%, latency <500ms, logs clean)
    ↓ YES: Proceed to next phase
    ↓ NO: ROLLBACK immediately
```

### Instant Rollback (Works Anytime)

```bash
# Copy-paste this entire block if needed:
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false

# Then: systemctl restart nginx
# Then: Verify monolith gets traffic

# Result: All traffic → monolith in <1 minute
```

---

## Health Checks

### Service Health

```bash
# All should return {"status":"ok"}
curl http://localhost:4030/health  # Upload
curl http://localhost:4031/health  # Resume
curl http://localhost:4032/health  # Notifications
curl http://localhost:3000/health  # Monolith
```

### Database Connectivity

```bash
# Should show "1" for each
psql -d tejoma_uploads -c "SELECT 1"
psql -d tejoma_resume -c "SELECT 1"
psql -d tejoma_notifications -c "SELECT 1"
psql -d tejoma_recruiting -c "SELECT 1"
```

### Dual-Write Status

```bash
# Should show DUAL_WRITE_ENABLED=true (Phase 2)
grep DUAL_WRITE_ENABLED .env.local

# Should show no errors in last 100 lines
tail -100 logs/app.log | grep -c error
```

---

## Incident Response Quick Reference

### If Service Crashes

```bash
# Restart it
docker-compose restart upload-service
# or resume-service / notifications-service

# Verify it's back
curl http://localhost:4030/health
```

### If Error Rate Spikes

1. **Check dashboards**: Is it really spiking or temporary glitch?
2. **Check logs**: What's the error?
3. **Check metrics**: Memory/CPU/DB connections?
4. **If unsure**: ROLLBACK immediately (always safe)
5. **If certain it's transient**: Wait 30 seconds, check again

### If Rollback Needed

```bash
# 1. Stop traffic to services
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false

# 2. Verify routing
curl http://localhost:3000/health

# 3. Alert team (use Template 20)

# 4. Investigate root cause
# (don't re-enable until fix is ready)
```

---

## Key Thresholds

### Critical (Stop Immediately)

- Error rate > 1% for 1 minute
- Latency p99 > 2000ms for 1 minute
- Memory > 90%
- Service not responding

### Warning (Monitor Closely)

- Error rate > 0.1% for 5 minutes
- Latency p99 > 500ms for 5 minutes
- Memory > 75%
- Database warnings in logs

### Normal (Continue)

- Error rate < 0.1%
- Latency p99 < 500ms
- Memory 50-75%
- Logs clean

---

## Essential File Locations

| File | Purpose |
|------|---------|
| .env.local | Feature flags & URLs |
| logs/app.log | Main log file |
| OPERATIONS_CHECKLIST.md | Day-by-day tasks |
| EXECUTION_ROADMAP_AUG10-31.md | Full timeline |
| INCIDENT_RESPONSE_PLAYBOOK.md | Troubleshooting |
| TEAM_COMMUNICATION_TEMPLATES.md | Messages to send |

---

## Feature Flags Reference

### Phase 2 (Aug 10-11)

```bash
DUAL_WRITE_ENABLED=true          # Enable dual-write mirror
UPLOAD_SERVICE_ENABLED=false     # Monolith handles all requests
RESUME_SERVICE_ENABLED=false     # Monolith handles all requests
NOTIFICATIONS_SERVICE_ENABLED=false  # Monolith handles all requests
```

### Phase 3 Staging (Aug 16-19)

```bash
DUAL_WRITE_ENABLED=true          # Keep enabled
UPLOAD_SERVICE_ENABLED=true      # Test in staging
RESUME_SERVICE_ENABLED=true      # Test in staging
NOTIFICATIONS_SERVICE_ENABLED=true  # Test in staging
```

### Phase 3 Production (Aug 21-28)

```bash
DUAL_WRITE_ENABLED=true
UPLOAD_SERVICE_ENABLED=true (increase 10% → 50% → 100%)
RESUME_SERVICE_ENABLED=true (increase 10% → 50% → 100%)
NOTIFICATIONS_SERVICE_ENABLED=true (increase 10% → 50% → 100%)
```

### Emergency Rollback (Always Works)

```bash
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
DUAL_WRITE_ENABLED=false
```

---

## What Happens Behind the Scenes

### Backfill (`npm run backfill:phase2`)

```
Monolith DB         Service DBs
  uploads        →    tejoma_uploads
  resumes        →    tejoma_resume
  notifications  →    tejoma_notifications
```

### Validation (`npm run validate:phase2`)

```
Count check:   Monolith row count == Service row count?
Sample check:  Random 5 rows identical in both?
Result:        ZERO DRIFT = Ready for cutover
```

### Dual-Write (During Production)

```
User request
    ↓
Monolith processes request ✅ (primary)
    ↓
Fire-and-forget to service ✅ (mirror)
    ↓
Response to user (immediate, never waits for mirror)
```

### Feature Flag Routing

```
If UPLOAD_SERVICE_ENABLED=true
    → Route to upload-service:4030
Else
    → Route to monolith:3000 (fallback)
```

---

## Who to Contact

**Phase 2 (Aug 10-11)**:
- On-call: [Name]
- Tech Lead: [Name]
- Escalation: [Name]

**Phase 3 (Aug 16-31)**:
- On-call: [Name]
- Tech Lead: [Name]
- Stakeholder: [Name]
- War room: #war-room

---

## Before You Start

- [ ] Read OPERATIONS_CHECKLIST.md completely
- [ ] Bookmark EXECUTION_ROADMAP_AUG10-31.md
- [ ] Print this page (or keep it open)
- [ ] Have INCIDENT_RESPONSE_PLAYBOOK.md ready
- [ ] Have on-call contact info available
- [ ] Test rollback command locally before production
- [ ] Ensure dashboards are accessible
- [ ] Verify Slack alerts are working

---

## Success Looks Like

**Aug 11, 17:00**: "Phase 2 complete. Zero drift. Proceeding to staging." ✅

**Aug 19, 17:00**: "Staging perfect. Load test 1000 req/s. Rollback drill successful." ✅

**Aug 23, 17:00**: "10% rollout clean. Zero incidents. Proceeding to 50%." ✅

**Aug 26, 17:00**: "50% rollout excellent. Ready for full cutover." ✅

**Aug 28, 17:00**: "100% cutover complete. Microservices live. Production stable." ✅

**Aug 31, 17:00**: "Migration complete. Zero downtime. Zero data loss. Mission accomplished." 🎉

---

**Keep this card visible. Update it daily. Reference it during incidents.**

**Questions? Check the playbooks. Incident? Use the checklist. Unsure? Escalate.**

---

Last updated: August 10, 2026
Valid through: August 31, 2026
