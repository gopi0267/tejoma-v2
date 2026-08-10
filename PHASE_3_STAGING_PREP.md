# Phase 3 Staging Preparation (Aug 11-15)

**Status**: Phase 2 ✅ Complete | Phase 3 Staging ⏳ Starting Aug 11

This 5-day preparation week (Aug 11-15) gets everything ready for Phase 3 staging deployment on Aug 16.

---

## Daily Breakdown

### Aug 11 (Sunday): Phase 2 Final Verification & Handoff

**Morning (09:00-12:00)**

- [ ] Review Phase 2 completion report
  - Backfill: ✅ 0 uploads, 0 resumes, 0 notifications
  - Validation: ✅ ZERO DRIFT DETECTED
  - Logs: ✅ Clean (no errors)

- [ ] Document Phase 2 results
  - [ ] Screenshots of final validation output
  - [ ] Save logs to archive
  - [ ] Note any issues encountered and how they were resolved

- [ ] Brief stakeholders
  ```
  Message: "Phase 2 validation complete. Zero drift confirmed. 
  Proceeding to Phase 3 staging deployment on Aug 16."
  ```

**Afternoon (14:00-17:00)**

- [ ] Prepare Phase 3 documentation package
  - [ ] Print or bookmark key docs:
    - EXECUTION_ROADMAP_AUG10-31.md
    - QUICK_REFERENCE.md
    - INCIDENT_RESPONSE_PLAYBOOK.md
  - [ ] Create team Slack channel: #tejoma-phase3
  - [ ] Pin key documents to Slack channel

- [ ] Prepare on-call rotation for Aug 16-31
  - [ ] Assign on-call engineer for each day
  - [ ] Send calendar invites with handoff times
  - [ ] Confirm everyone has phone/Slack access

**End of Day**

- [ ] Status: Phase 2 complete, Phase 3 prep starting
- [ ] Team informed, documentation ready
- [ ] On-call schedule confirmed

---

### Aug 12 (Monday): Staging Environment Preparation

**Morning (09:00-12:00) - Infrastructure Setup**

- [ ] Verify staging servers are available
  ```bash
  ssh staging-server-1
  # Should connect without issues
  
  docker --version  # Should be available
  systemctl status docker  # Should be running
  ```

- [ ] Check staging database connectivity
  ```bash
  psql -h staging-db.internal -U admin -d tejoma_recruiting -c "SELECT 1"
  # Should return 1
  ```

- [ ] Prepare staging .env files
  - [ ] Copy .env.staging for upload-service
  - [ ] Copy .env.staging for resume-service
  - [ ] Copy .env.staging for notifications-service
  - [ ] Verify all URLs point to staging (not production)
  - [ ] Verify database hosts point to staging (not production)

- [ ] Create staging service databases
  ```bash
  npm run setup:phase1-dbs -- --env=staging
  # Should create: tejoma_uploads, tejoma_resume, tejoma_notifications (staging versions)
  ```

**Afternoon (14:00-17:00) - Service Deployment Prep**

- [ ] Build Docker images for staging
  ```bash
  docker build -t upload-service:staging upload-service/
  docker build -t resume-service:staging resume-service/
  docker build -t notifications-service:staging notifications-service/
  ```

- [ ] Tag images for registry
  ```bash
  docker tag upload-service:staging registry.internal/upload-service:staging
  docker tag resume-service:staging registry.internal/resume-service:staging
  docker tag notifications-service:staging registry.internal/notifications-service:staging
  ```

- [ ] Push to image registry
  ```bash
  docker push registry.internal/upload-service:staging
  docker push registry.internal/resume-service:staging
  docker push registry.internal/notifications-service:staging
  ```

- [ ] Prepare docker-compose or Kubernetes manifests for staging
  - [ ] Use staging image tags
  - [ ] Use staging database credentials
  - [ ] Use staging port numbers (4030, 4031, 4032 on staging servers)
  - [ ] Set resource limits for staging load

**End of Day**

- [ ] Status: Staging infrastructure ready
- [ ] Services buildable and pushabable
- [ ] Databases created
- [ ] Ready for deployment

---

### Aug 13 (Tuesday): Monitoring & Alerting Setup

**Morning (09:00-12:00) - Prometheus & Grafana**

- [ ] Verify Prometheus is running in staging
  ```bash
  curl http://prometheus-staging:9090/-/healthy
  # Should return 200 OK
  ```

- [ ] Configure scrape targets for new services
  ```yaml
  # prometheus.yml
  scrape_configs:
    - job_name: 'upload-service'
      static_configs:
        - targets: ['upload-service-staging:4030']
    - job_name: 'resume-service'
      static_configs:
        - targets: ['resume-service-staging:4031']
    - job_name: 'notifications-service'
      static_configs:
        - targets: ['notifications-service-staging:4032']
  ```

- [ ] Reload Prometheus config
  ```bash
  curl -X POST http://prometheus-staging:9090/-/reload
  ```

- [ ] Create Grafana dashboards for each service
  - [ ] Upload-service: Upload metrics, S3 operations, error rates
  - [ ] Resume-service: Extraction jobs, skill extraction, latency
  - [ ] Notifications-service: WebSocket connections, messages sent, latency

- [ ] Set up critical alerts in Grafana
  - [ ] Error rate > 1% → Page on-call engineer
  - [ ] Latency p99 > 2000ms → Alert to #war-room
  - [ ] Memory > 90% → Alert to #war-room
  - [ ] Service unhealthy → Page on-call engineer

**Afternoon (14:00-17:00) - Slack Integration**

- [ ] Configure Slack webhook for alerts
  ```bash
  # In Grafana Notification Channels
  Webhook URL: https://hooks.slack.com/services/[YOUR_WEBHOOK_KEY]
  ```

- [ ] Test alert delivery
  - [ ] Trigger test alert from Prometheus
  - [ ] Verify message appears in #tejoma-phase3 Slack channel
  - [ ] Confirm format is readable (service name, metric, value)

- [ ] Set up on-call notifications
  - [ ] Create Slack bot token for PagerDuty/on-call integration
  - [ ] Configure on-call schedule notifications
  - [ ] Test page delivery to on-call engineer's phone

- [ ] Create Slack commands for status checks
  ```
  /phase3-status  → Shows current metrics summary
  /rollback       → Shows rollback procedure
  /incident       → Opens incident response template
  ```

**End of Day**

- [ ] Status: Full monitoring stack operational in staging
- [ ] Dashboards created and tested
- [ ] Slack alerts working
- [ ] On-call notifications ready

---

### Aug 14 (Wednesday): Testing & Documentation

**Morning (09:00-12:00) - Feature Flag Documentation**

- [ ] Document how feature flags work in your infrastructure
  ```markdown
  # Feature Flags
  
  Location: .env.staging (upload-service, resume-service, notifications-service)
  
  UPLOAD_SERVICE_ENABLED=true/false
  - true: Route API requests to upload-service:4030
  - false: Route to monolith:3000 (fallback)
  
  To change: Edit .env on staging servers, restart nginx
  Time to effect: <30 seconds
  ```

- [ ] Document rollback procedure
  ```markdown
  # Instant Rollback
  
  1. SSH to staging-gateway
  2. Edit /etc/nginx/nginx.conf or .env
  3. Set all _ENABLED flags to false
  4. Run: systemctl restart nginx
  5. Verify: curl http://staging-gateway/health
  6. Time: <1 minute
  ```

- [ ] Create feature flag change log template
  ```
  Date: Aug 16, 09:00
  Changed by: [Name]
  Change: Set UPLOAD_SERVICE_ENABLED=true
  Reason: Phase 3 staging deployment started
  Status: ✅ All systems healthy
  ```

**Afternoon (14:00-17:00) - Rollback Drill**

- [ ] Plan rollback drill procedure
  ```
  1. Deploy services to staging
  2. Enable feature flags (all services at 100%)
  3. Wait 10 minutes (let metrics stabilize)
  4. Execute rollback:
     - Disable all feature flags
     - Restart nginx
     - Verify traffic to monolith
  5. Re-enable flags
  6. Verify systems back up
  7. Document: Time to rollback = [X] seconds
  ```

- [ ] Test rollback procedure locally (in dev)
  - [ ] Set all flags to true
  - [ ] Verify requests route to services
  - [ ] Set all flags to false
  - [ ] Verify requests route to monolith
  - [ ] Measure time for each step

- [ ] Create rollback runbook
  - [ ] Step-by-step procedure
  - [ ] Estimated time for each step
  - [ ] Verification steps to confirm rollback worked
  - [ ] Who to contact if issues

**End of Day**

- [ ] Status: All documentation complete
- [ ] Rollback procedure tested locally
- [ ] Team trained on feature flags
- [ ] Ready for actual deployment

---

### Aug 15 (Thursday): Final Checks & Readiness

**Morning (09:00-12:00) - Staging Environment Validation**

- [ ] Verify all staging components running
  ```bash
  # Service health
  curl http://upload-service-staging:4030/health
  curl http://resume-service-staging:4031/health
  curl http://notifications-service-staging:4032/health
  
  # Database connectivity
  psql -d tejoma_uploads -c "SELECT 1"
  psql -d tejoma_resume -c "SELECT 1"
  psql -d tejoma_notifications -c "SELECT 1"
  
  # Monitoring
  curl http://prometheus-staging:9090/-/healthy
  curl http://grafana-staging:3000/api/health
  ```

- [ ] Verify feature flags in place
  - [ ] All flags set to false (safe default)
  - [ ] Logged in .env files
  - [ ] Known to on-call team

- [ ] Verify Slack channels & alerts
  - [ ] #tejoma-phase3 created and staffed
  - [ ] #war-room created for incident response
  - [ ] Test message sent to both channels
  - [ ] Webhook verified working

**Afternoon (14:00-17:00) - Team Briefing**

- [ ] Brief entire team on Phase 3 tomorrow
  ```
  Agenda:
  • Timeline: Aug 16-19 staging, Aug 21-31 production
  • Responsibilities: who does what
  • Escalation: when and how to escalate
  • Rollback: instant recovery procedure
  • Communication: how we stay in sync
  ```

- [ ] Run through deployment scenario (dry run)
  - [ ] Walk through Aug 16 deployment steps
  - [ ] Simulate each phase: pre-deploy → deploy → health check → smoke test
  - [ ] Practice escalation: "What if error rate spikes at 10:05?"
  - [ ] Practice rollback: "Flip flags to false in 30 seconds"

- [ ] Confirm on-call assignments
  - [ ] Aug 16-19 (Staging Lead): [Name]
  - [ ] Aug 16: On-call: [Name]
  - [ ] Aug 17: On-call: [Name]
  - [ ] Etc. for full Aug 16-31 period

- [ ] Final questions & concerns
  - [ ] Anyone unsure about their role?
  - [ ] Any blockers or concerns?
  - [ ] Last-minute questions?

**Evening (17:00-18:00) - Sign-Off**

- [ ] Create Phase 3 readiness checklist
  ```
  ✅ Phase 2 complete
  ✅ Staging infrastructure ready
  ✅ Services built and tagged
  ✅ Databases created
  ✅ Monitoring dashboards live
  ✅ Slack alerts working
  ✅ Feature flags documented
  ✅ Rollback procedure tested
  ✅ Team trained and briefed
  ✅ On-call schedule confirmed
  ```

- [ ] Get stakeholder approval to proceed
  ```
  Message: "Phase 3 staging deployment ready for Aug 16. 
  All systems green. Team briefed. Ready to proceed?"
  ```

- [ ] Confirm go-ahead for Aug 16

**End of Day**

- [ ] Status: ✅ READY FOR PHASE 3 STAGING (Aug 16)
- [ ] All preparations complete
- [ ] Team aligned
- [ ] Stakeholders approved
- [ ] Standing by for Aug 16 deployment

---

## Preparation Checklist

**Infrastructure**
- [ ] Staging servers provisioned
- [ ] Staging databases created
- [ ] Docker images built and pushed
- [ ] Kubernetes/docker-compose manifests ready
- [ ] Networking configured (staging services can reach each other)

**Monitoring**
- [ ] Prometheus scraping all services
- [ ] Grafana dashboards created
- [ ] Alert rules configured
- [ ] Slack webhook integration verified
- [ ] On-call paging working

**Documentation**
- [ ] Feature flag procedures documented
- [ ] Rollback procedure tested and documented
- [ ] Incident response playbook printed
- [ ] Quick reference card prepared
- [ ] Team communication templates ready

**Team**
- [ ] On-call schedule confirmed (Aug 16-31)
- [ ] Team briefed on procedures
- [ ] Dry-run deployment completed
- [ ] Questions answered
- [ ] Everyone confident in their role

**Go/No-Go Decision**
- [ ] All checklist items complete? ✅ YES
- [ ] Stakeholder approval? ✅ YES
- [ ] Team ready? ✅ YES
- [ ] **Status: READY FOR AUG 16 DEPLOYMENT ✅**

---

## If Issues Arise During Aug 11-15

**Issue: Staging infrastructure not ready**
- Action: Extend Aug 12 tasks to Aug 13
- Escalate to infrastructure team
- Do not proceed to Aug 16 until ready

**Issue: Monitoring alerts not working**
- Action: Debug Slack webhook and Grafana integration
- Test end-to-end: trigger alert → verify Slack message
- Do not proceed until confirmed working

**Issue: Team members unavailable**
- Action: Adjust on-call schedule
- Ensure every shift is covered Aug 16-31
- Redistribute responsibilities as needed

**Issue: Deployment dry-run fails**
- Action: Identify and fix the issue
- Practice until deployment steps are smooth
- Do not proceed until dry-run successful

---

## Aug 15 Evening Status Report

Send to stakeholders at 17:00:

```
Phase 3 Staging - Readiness Report
Date: Aug 15, 2026

✅ STAGING ENVIRONMENT: READY
- Services deployed and healthy
- Databases created and synced
- Monitoring dashboards live
- Alerts configured and tested

✅ TEAM READINESS: CONFIRMED
- All personnel briefed
- On-call schedule finalized
- Deployment dry-run successful
- Rollback procedure tested

✅ DOCUMENTATION: COMPLETE
- Procedures documented
- Runbooks finalized
- Team trained

RECOMMENDATION: PROCEED WITH AUG 16 STAGING DEPLOYMENT

Next: Phase 3 Staging deployment begins 08:00 Aug 16
Timeline: Aug 16-19 (4 days) for staging validation
Then: Production rollout begins Aug 21
```

---

## Success Looks Like (Aug 15, 18:00)

✅ All infrastructure ready and tested
✅ All services built, tagged, and pushable
✅ Monitoring stack operational
✅ Team trained and confident
✅ On-call schedule complete
✅ Stakeholders approve go-ahead
✅ Standing by for Aug 16 deployment

---

**This 5-day preparation ensures Aug 16 deployment is smooth and confident.**

Use this checklist daily. Check off items as you complete them. If any section is 🔴 RED, escalate immediately.

**Aug 15, 18:00**: All items should be ✅ GREEN.

Next phase: PHASE_3_STAGING_DEPLOYMENT.md (Aug 16-19)
