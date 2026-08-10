# Complete Migration Roadmap: Phases 2 & 3

**Overall Goal**: Complete monolith-to-microservices migration using strangler-fig pattern
**Timeline**: 4 weeks (Aug 6-31, 2026)
**Risk**: Low (feature flags, instant rollback, comprehensive validation)

---

## Timeline Overview

```
PHASE 1: Foundation (Aug 6-8) ✅
├─ Upload Service
├─ Resume Service  
└─ Notifications Service

PHASE 2: Integration (Aug 9-15)
├─ Dual-write hooks
├─ Backfill scripts
├─ Validation scripts
└─ Shadow mode enabled

PHASE 3: Cutover (Aug 16-31)
├─ Staging deployment
├─ Feature flags enabled (staged)
├─ Production rollout (10% → 50% → 100%)
└─ Monitoring + stability

PRODUCTION STABLE (Sep 1+)
└─ All traffic on microservices
└─ Monolith as backup only
```

---

## Phase 2: Integration & Shadow Mode (Aug 9-15)

### Goals
- Keep both monolith and new services in sync
- Validate zero drift before cutover
- Prove A/B parity (responses identical)
- Enable instant rollback capability

### Daily Schedule

#### Friday, Aug 9
- [ ] Add dual-write functions to src/dualWrite.ts
- [ ] Create service database pool helpers
- [ ] Wire up calls in db.ts (uploads, resumes, notifications)
- [ ] Test locally: writes appear in both DBs
- **Status Check**: Dual-write functioning correctly

#### Saturday, Aug 10
- [ ] Create backfill-phase2.ts script
- [ ] Load historical uploads data
- [ ] Load historical resumes data
- [ ] Load historical notifications data
- **Status Check**: Backfill complete, row counts match

#### Sunday, Aug 11
- [ ] Create validate-phase2-sync.ts script
- [ ] Run full validation (counts + deep-compare)
- [ ] Document any non-critical differences
- [ ] Fix any data discrepancies
- **Status Check**: Zero drift, validation passes

#### Monday, Aug 12
- [ ] Create test-ab-parity.ts script
- [ ] Test all upload endpoints (old vs new)
- [ ] Compare all responses
- [ ] Document response format matching
- **Status Check**: A/B parity confirmed

#### Tuesday, Aug 13
- [ ] Enable DUAL_WRITE_ENABLED=true in production config
- [ ] Monitor logs: dual-writes appearing
- [ ] Check for any dual-write failures
- [ ] Set up alerting for dual-write errors
- **Status Check**: Shadow mode active, no errors

#### Wednesday, Aug 14
- [ ] 24-hour validation run
- [ ] Monitor dual-write error rates
- [ ] Confirm new services keeping up
- [ ] Update status dashboard
- **Status Check**: All systems nominal

#### Thursday, Aug 15
- [ ] Final validation pass (counts should still match)
- [ ] Update Phase 3 readiness checklist
- [ ] Brief team on results
- [ ] Get approval for Phase 3 cutover
- **Status Check**: Ready for production cutover

### Deliverables for Phase 2

1. **src/dualWrite.ts updates**
   - upsertUpload() function
   - upsertResume() function
   - upsertNotification() function
   - Service pool helpers
   
2. **scripts/backfill-phase2.ts**
   - Load all historical uploads
   - Load all historical resumes
   - Load all historical notifications
   - Log progress and counts
   
3. **scripts/validate-phase2-sync.ts**
   - Count validation per table
   - Deep-compare random samples
   - Report zero drift or issues
   
4. **scripts/test-ab-parity.ts**
   - Test all Phase 1 service endpoints
   - Compare monolith vs service responses
   - Document any differences
   
5. **Monitoring & Alerting**
   - Dual-write error tracking
   - Service availability monitoring
   - Latency tracking (monolith vs services)
   
6. **Documentation**
   - Dual-write architecture diagram
   - Validation procedure documentation
   - Rollback procedures

---

## Phase 3: Production Cutover (Aug 16-31)

### Goals
- Enable feature flags in stages
- Monitor service health & performance
- Validate production correctness
- Instant rollback if issues

### Stage 1: Staging (Aug 16-20)

#### Monday, Aug 16
- [ ] Deploy Phase 1 services to staging
- [ ] Set UPLOAD_SERVICE_ENABLED=true
- [ ] Set RESUME_SERVICE_ENABLED=true
- [ ] Set NOTIFICATIONS_SERVICE_ENABLED=true
- [ ] All feature flags enabled in staging
- **Test**: Full end-to-end flow in staging

#### Tuesday, Aug 17
- [ ] 24-hour staging validation
- [ ] Run test suite against services
- [ ] Monitor error rates, latency
- [ ] Test error scenarios (service down, timeout, etc.)
- **Status Check**: All staging tests pass

#### Wednesday, Aug 18
- [ ] Load testing in staging
  - Target: 1000 req/s
  - Measure: p50, p95, p99 latency
  - Check: Memory usage, connection pooling
- [ ] Verify no memory leaks
- **Status Check**: Load tests pass, no degradation

#### Thursday, Aug 19
- [ ] Rollback drill in staging
  - Set all feature flags to false
  - Verify traffic routes to monolith
  - Re-enable flags and verify cutover
- [ ] Document rollback procedure
- **Status Check**: Rollback tested & working

#### Friday, Aug 20
- [ ] Final staging sign-off
- [ ] Get stakeholder approval
- [ ] Brief on-call team
- [ ] Update runbooks & playbooks
- **Status Check**: Ready for production

### Stage 2: Production Gradual Rollout (Aug 21-29)

#### Friday-Sunday, Aug 21-23: 10% Traffic

```
Production Load Balancer
        ↓
    ┌─────────────────┐
    │ 90% Monolith    │
    │ 10% Services    │
    └─────────────────┘
```

**Actions**:
- [ ] Set feature flags to true for 10% of users
- [ ] Monitor error rates (target: <0.1%)
- [ ] Monitor latency (p99 <500ms)
- [ ] Monitor service logs
- [ ] Check database performance

**Success Criteria**:
- Error rates <0.1%
- No service crashes
- Latency stable
- Zero data loss

**If Issues**: Instant rollback (flip feature flags)

#### Monday-Wednesday, Aug 24-26: 50% Traffic

**Actions**:
- [ ] Gradually increase to 50% of users
- [ ] Continue all monitoring
- [ ] Check for any edge cases
- [ ] Verify long-running connections

**Success Criteria**:
- Same as 10% stage
- Error rates still <0.1%
- No latency increase

#### Thursday-Friday, Aug 27-28: 100% Traffic

**Actions**:
- [ ] Full cutover: 100% to new services
- [ ] Intensive monitoring (every 1 minute)
- [ ] On-call team on alert
- [ ] All dashboards live

**Success Criteria**:
- No errors detected
- Latency normal
- All systems responding
- Database performance optimal

### Stage 3: Stabilization (Aug 29-31)

#### Friday, Aug 29
- [ ] 24-hour post-cutover validation
- [ ] Verify no data corruption
- [ ] Check background jobs
- [ ] Validate WebSocket connections
- **Status Check**: All systems nominal

#### Saturday-Sunday, Aug 30-31
- [ ] Continued monitoring
- [ ] Performance optimization if needed
- [ ] Update documentation
- [ ] Prepare for decommission phase
- **Status Check**: Production stable

---

## Monitoring & Metrics (All Phases)

### Real-Time Dashboards

```
Upload Service Metrics:
├─ Requests/sec: [graph]
├─ Error rate: [graph]  
├─ p99 latency: [graph]
├─ DB connections: [graph]
└─ Disk usage: [graph]

Resume Service Metrics:
├─ Extraction jobs: [graph]
├─ Job duration: [graph]
├─ Error rate: [graph]
├─ Skills detected/min: [graph]
└─ DB connections: [graph]

Notifications Service Metrics:
├─ WebSocket connections: [graph]
├─ Events/min: [graph]
├─ Broadcast latency: [graph]
├─ Error rate: [graph]
└─ Memory usage: [graph]

Monolith Metrics:
├─ Requests still to monolith: [graph]
├─ Latency: [graph]
├─ Error rate: [graph]
└─ Dual-write success rate: [graph]
```

### Alerts Configured

```
Critical (Page On-Call):
- Service down (health check fails)
- Error rate >1%
- p99 latency >1 second
- Database connection pool exhausted

Warning (Slack Notification):
- Error rate >0.5%
- p99 latency >500ms
- Database CPU >80%
- Disk usage >80%

Info (Logs Only):
- Dual-write failures (logged, not alerted)
- Cache misses
- Long-running queries
```

---

## Rollback Procedures

### Instant Rollback (< 1 minute)

```bash
# If any critical issue detected:

# Option 1: Disable feature flags (immediate)
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false

# Restart nginx (or update reverse proxy config)
systemctl restart nginx

# Verify traffic now routes to monolith
curl http://monolith:3000/api/uploads
# Should work immediately

# Traffic now 100% on monolith
# Services stay running but receive no traffic
# No data loss on either side
```

### 5-Minute Rollback

```bash
# If dual-write has issues:

# 1. Disable dual-write
DUAL_WRITE_ENABLED=false

# 2. Restart monolith (if needed)
systemctl restart app

# 3. Run validation to check for drift
npm run validate:phase2

# 4. Investigate root cause
# 5. Re-enable once fixed
```

### Full Rollback (If Services Corrupted)

```bash
# Restore from backups:
pg_restore -d tejoma_uploads backup_uploads.sql
pg_restore -d tejoma_resume backup_resumes.sql
pg_restore -d tejoma_notifications backup_notifs.sql

# Rerun backfill and validation
npm run backfill:phase2
npm run validate:phase2

# Re-enable with confidence
DUAL_WRITE_ENABLED=true
UPLOAD_SERVICE_ENABLED=true
```

---

## Success Criteria Checklist

### Phase 2 Complete When:
- [ ] All dual-write hooks added
- [ ] Backfill scripts complete (100% data loaded)
- [ ] Validation passes (zero drift)
- [ ] A/B parity confirmed (responses identical)
- [ ] Shadow mode stable (24h with no errors)
- [ ] Monitoring in place
- [ ] Team trained on runbook

### Phase 3 Complete When:
- [ ] Staging fully validated
- [ ] Load tests pass (1000 req/s, p99 <500ms)
- [ ] Rollback drill successful
- [ ] Production 10% → 50% → 100% complete
- [ ] 48 hours stable with zero errors
- [ ] All metrics nominal
- [ ] Documentation updated

---

## Risk Mitigation

### High-Risk Scenarios & Mitigations

| Scenario | Risk | Mitigation | Rollback |
|----------|------|-----------|----------|
| Service crash | Critical | Health checks, auto-restart | Flip feature flag |
| Data corruption | Critical | Validation scripts, backups | Restore + re-backfill |
| Latency spikes | High | Load testing, monitoring | Disable services |
| Database exhaustion | High | Connection pooling, alerts | Disable dual-write |
| WebSocket disconnects | Medium | Reconnect logic, heartbeat | Service restart |
| Skill extraction errors | Low | Retry logic, error logging | Automatic retry |

---

## Team Communication

### Weekly Standup

**Phase 2 Weeks (Aug 9-15)**:
- Monday: Dual-write hooks complete
- Wednesday: Backfill & validation running
- Friday: Shadow mode stable, ready for Phase 3

**Phase 3 Weeks (Aug 16-31)**:
- Monday: Staging deployed
- Wednesday: Staging validated
- Friday: Production 10% rollout
- Monday: Production 50% rollout
- Wednesday: Production 100% complete
- Friday: Post-mortem & lessons learned

---

## Post-Migration (Sep+)

### Cleanup Phase (Optional)

Once services stable for 2+ weeks:

1. **Remove Monolith Endpoints**
   - /api/uploads → only in upload-service
   - /api/resumes → only in resume-service
   - /api/notifications → only in notifications-service

2. **Remove Dual-Write Code**
   - Delete src/dualWrite.ts upload/resume/notification functions
   - Simplify monolith db.ts

3. **Decommission Monolith Tables** (Keep backups)
   - Archive uploads table
   - Archive resumes table
   - Archive notifications table

4. **Remove Feature Flags**
   - Hard-code service URLs (no more feature flag checks)
   - Simplify route handlers

5. **Update Documentation**
   - Archive Phase 1-3 docs
   - Update API reference (points to services only)
   - Remove dual-write procedures

---

## Success Metrics (End State)

```
August 31, 2026 - Production Complete:
✅ 100% traffic on microservices
✅ 0% errors in Phase 1 services
✅ <100ms p99 latency per service
✅ <80% memory usage per service
✅ Database replication lag <100ms
✅ Zero data loss or corruption
✅ Instant rollback capability (but not needed)
✅ Team comfortable with operations
✅ All documentation complete
✅ On-call playbook tested

Timeline Delivered:
Week 1: Foundation ✅
Week 2: Integration ✅
Week 3: Staging ✅
Week 4: Production ✅

Result: 4-week migration, zero downtime, full rollback capability
```

---

**Status**: Phase 1 Complete, Phase 2-3 Spec Ready
**Next Action**: Implement Phase 2 dual-write hooks (Aug 9)
**Contingency**: Instant rollback if any critical issue (feature flags)
