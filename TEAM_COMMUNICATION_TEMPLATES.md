# Team Communication Templates: Phase 2 & 3

Use these templates for Slack messages, emails, and status reports during Phase 2-3 execution.

---

## Phase 2 Status Updates (Aug 10-11)

### Template 1: Phase 2 Kick-Off (Aug 10, 09:00)

```
🚀 Phase 2 Validation Starting Now

Backfill & validation scripts running:
• npm run backfill:phase2 (5 min)
• npm run validate:phase2 (5 min)

Expected: Zero drift confirmed by 09:15
Next: 24h monitoring of logs

Who should care: Tech lead, on-call
Any blockers? Reply here
```

---

### Template 2: Phase 2 Success (Aug 10, 09:20)

```
✅ Phase 2 Backfill Complete

Results:
• Uploads: 0 backfilled
• Resumes: 0 backfilled
• Notifications: 1,500 backfilled
• Drift check: ZERO DRIFT DETECTED ✅

Now: Monitoring dual-write logs for 24h
Status: 🟢 GREEN (all systems normal)

Proceeding to 24h monitoring window...
```

---

### Template 3: Phase 2 Error Reported (Aug 10, 14:32)

```
⚠️  Phase 2 Issue Detected

Service: Notifications dual-write
Error: Connection timeout
First seen: 14:30 (2 minutes ago)
Error rate: 1.2% of writes
Duration: < 5 minutes

Action taken:
1. ✓ Checked service health (OK)
2. ✓ Checked network connectivity (OK)
3. → Investigating root cause
4. → Standing by for decision

Need: On-call engineer to review
Estimated resolution: 30-60 minutes

Will escalate to tech lead at 14:50 if not resolved
```

---

### Template 4: Phase 2 Resolution (Aug 10, 14:47)

```
✅ Phase 2 Issue Resolved

Root cause: Connection pool temporarily exhausted (peak load)
Fix applied: Restarted notifications-service
Verification: All systems green, zero errors in logs

Resuming: 24h monitoring window
New status: 🟢 GREEN
Resolution time: 17 minutes

Continuing Phase 2 as planned...
```

---

### Template 5: Phase 2 Completion (Aug 11, 17:00)

```
✅ Phase 2 Complete - Ready for Phase 3

24-hour validation window completed:
• Backfill: ✅ Successful
• Validation: ✅ Zero drift
• Monitoring: ✅ Clean logs (24h)
• Rollback test: ✅ Ready

Summary:
• 0 critical incidents
• 0 data loss
• 100% uptime
• All systems nominal

Decision: ✅ APPROVED TO PROCEED
Next: Phase 3 staging deployment (Aug 16)

Team: Begin Phase 3 prep starting Aug 12
(DEPLOYMENT.md has Aug 12-15 checklist)
```

---

## Phase 3 Staging Status (Aug 16-19)

### Template 6: Staging Deployment Start (Aug 16, 08:00)

```
🚀 Phase 3 Staging Deployment Starting

Timeline: Aug 16-19 (4 days)
Target: Deploy 3 services, full testing, sign-off

Tasks:
• Aug 16: Deploy services + smoke tests
• Aug 17: Load testing (1000 req/s) + rollback drill
• Aug 18-19: Stakeholder review + sign-off

Who: [Team names]
On-call: [Person]
Status board: [Link to dashboard]

Proceed? Reply with 👍 to confirm
```

---

### Template 7: Staging Deployment Complete (Aug 16, 12:30)

```
✅ Services Deployed to Staging

Upload-service (port 4030):   ✅ Healthy
Resume-service (port 4031):   ✅ Healthy
Notifications-service (port 4032): ✅ Healthy

Next: Smoke tests + A/B parity tests
Proceeding with Aug 16 afternoon testing
```

---

### Template 8: Staging Load Test Results (Aug 17, 15:45)

```
✅ Staging Load Test Complete

Results:
• Target: 1000 req/s for 10 minutes
• Error rate: 0.02% (target: <0.1%) ✅
• Latency p99: 87ms (target: <500ms) ✅
• Memory per service: 120MB (target: <500MB) ✅
• Database connections: 8/20 (good headroom)

Status: 🟢 PASSED

Next: Rollback drill today at 16:30
```

---

### Template 9: Rollback Drill Complete (Aug 17, 17:00)

```
✅ Rollback Drill Successful

Procedure: Flip all feature flags to false
Time to recover: 42 seconds ✅ (target: <1 min)
Traffic routing: All to monolith ✅
Data integrity: Verified ✅

Status: 🟢 READY FOR PRODUCTION

Waiting: Stakeholder approval to proceed (Aug 18-19)
```

---

### Template 10: Staging Sign-Off (Aug 19, 14:00)

```
✅ Phase 3 Staging - APPROVED

Sign-off from:
• QA: ✅ All tests passing
• Tech Lead: ✅ Load test results acceptable
• Stakeholder: ✅ Ready for production

Next: Phase 3 Production rollout (Aug 21)

Everyone: Get rest before Aug 21 🏖️
Production goes 10% at 08:00 on Aug 21
```

---

## Phase 3 Production Status (Aug 21-28)

### Template 11: Production 10% Rollout Start (Aug 21, 08:00)

```
🚀 Phase 3 Production - 10% Rollout Live

Traffic: 10% to upload-service + resume-service + notifications-service
Time: Aug 21, 08:00 UTC

On-call: [Name] - on Slack #war-room
Escalation: Tech Lead [Name]

Monitoring:
• Slack alerts: Enabled
• Dashboard: [Link]
• War room: #war-room (everyone join)

Status: 🔵 LIVE (monitoring)
```

---

### Template 12: Production 10% - Hour 1 Update (Aug 21, 09:05)

```
✅ 10% Rollout - 1 Hour Update

Metrics:
• Error rate: 0.03% (target: <0.1%) ✅
• Latency p99: 92ms (target: <500ms) ✅
• Memory: Stable 140MB per service ✅
• Logs: Clean ✅

Status: 🟢 GREEN

Continuing monitoring. No rollback needed.
Next update: 10:00
```

---

### Template 13: Production 10% Complete (Aug 23, EOD)

```
✅ 10% Rollout - 3 Days Complete

Summary:
• Duration: 72 hours
• Error rate: 0.02% avg (all green) ✅
• Latency: All p99 <100ms ✅
• Incidents: 0
• Data loss: 0

Status: 🟢 EXCELLENT

Decision: ✅ APPROVED TO PROCEED TO 50%
Next: 50% rollout starts Aug 24 at 08:00
```

---

### Template 14: Production 50% Rollout Start (Aug 24, 08:00)

```
🚀 Phase 3 Production - 50% Rollout Live

Traffic: 50% to upload-service + resume-service + notifications-service
Previous: 10% ran clean for 72 hours ✅

Monitoring: Same as 10% (continuing)
On-call: [Name]

Status: 🔵 LIVE (continuing monitoring)
```

---

### Template 15: Production 50% Complete (Aug 26, EOD)

```
✅ 50% Rollout - 3 Days Complete

Summary:
• Duration: 72 hours (50% of traffic)
• Error rate: 0.01% avg ✅
• Incidents: 0
• Data loss: 0

Comparison to 10%:
• No new issues
• Performance even better
• Logs completely clean

Decision: ✅ APPROVED FOR 100% CUTOVER
Next: 100% rollout starts Aug 27 at 08:00
```

---

### Template 16: Production 100% Rollout Start (Aug 27, 08:00)

```
🚀 Phase 3 Production - 100% Cutover Live

Traffic: 100% to upload-service + resume-service + notifications-service
Monolith: Backup only (no traffic)

Previous results:
• 10%: 72 hours perfect ✅
• 50%: 72 hours perfect ✅
• Ready for full cutover ✅

War room: #war-room (full team)
On-call: [Name]
Tech lead: [Name]
24/7 monitoring activated

Status: 🔴 LIVE CUTOVER (intensive monitoring)

Checkpoints:
• 09:00 - All systems green? ✅
• 12:00 - Continuing to monitor
• 17:00 - End of day report
```

---

### Template 17: Production 100% Success (Aug 27, 17:00)

```
✅ 100% Cutover - Day 1 Complete

Full cutover status:
• Error rate: 0.01% ✅
• Latency: All p99 <100ms ✅
• Incidents: 0
• Data loss: 0
• Monolith: Idle (as planned)

Status: 🟢 EXCELLENT

Continuing: 24/7 monitoring through Aug 28
Then: Stabilization phase Aug 29-31
```

---

### Template 18: Cutover Complete (Aug 28, 17:00)

```
🎉 Migration Complete - Production Stable

Full microservices live:
✅ Upload-service: 100% traffic
✅ Resume-service: 100% traffic
✅ Notifications-service: 100% traffic
✅ Monolith: Backup (zero traffic)

Timeline:
• Phase 1: Aug 6 ✅
• Phase 2: Aug 10-11 ✅
• Phase 3 Staging: Aug 16-19 ✅
• Phase 3 Production: Aug 21-28 ✅

Incidents: 0
Data loss: 0
Downtime: 0

Next: Stabilization & handoff (Aug 29-31)
Then: Operations team takes over

🎉 Thank you to everyone who made this possible!
```

---

## Incident Communication (If Needed)

### Template 19: Incident Declared (During 50% or 100% Rollout)

```
🚨 INCIDENT DECLARED

Service: [Which service]
Issue: [Brief description]
Impact: [% of users, if known]
Time detected: [When]

On-call engineer: [Name]
Tech lead: [Name]
Stakeholder: [Name]

Action: Investigating root cause
Estimated time to resolution: [When]

War room: #war-room (join if involved)
Status updates: Every 5 minutes

Everyone else: Continue normal operations
(This is not your incident unless you're on-call)
```

---

### Template 20: Rollback Decision (If Incident Unsolved)

```
⚠️  ROLLBACK INITIATED

Service: [Which service]
Reason: [Error rate exceeded threshold]
Time to rollback: [Duration] (< 1 minute)

Action taken:
✓ Feature flags disabled
✓ Traffic routed to monolith
✓ Services going idle

Verification:
✓ Monolith receiving traffic
✓ Error rate dropping to 0%
✓ Users unaffected (seamless)

Status: 🟢 ROLLBACK COMPLETE
Next: Root cause investigation continues
Updating: Incident playbook with new procedure

On-call engineer will brief team at [Time]
```

---

### Template 21: Incident Resolution (Post-Rollback)

```
✅ Incident Resolved

Root cause: [What we found]
Impact: [How many users, how long]
Duration: [When detected to when resolved]

Fix applied: [What changed]
Where: [Which service/code]

Deployed to: 
• Staging: [When] ✅
• Production: [When] ✅

Verification: [What we tested]

Next steps:
1. [Action item 1]
2. [Action item 2]
3. Post-incident review (Aug [Date])

Status: 🟢 INCIDENT CLOSED
```

---

## Daily Standup Format (Phase 3 Production)

### Template 22: Daily Standup (Aug 21-31)

```
📊 Daily Standup - Aug [Date]

Previous 24h metrics:
• Error rate: [0-0.1%]? ✅/❌
• Latency p99: [<500ms]? ✅/❌
• Memory: [<75%]? ✅/❌
• Incidents: [0]? ✅/❌

Rollout status:
• 10%: ✅ Complete (Aug 21-23)
• 50%: [🟢 Live/✅ Complete] (Aug 24-26)
• 100%: [🟡 Live/✅ Complete] (Aug 27-28)

Blockers: [None/List]

What to watch today:
• [Any specific metrics or behaviors]

Go-live decision:
• 10% → 50%? [YES/NO]
• 50% → 100%? [YES/NO]
• Rollback? [NO]

Status: 🟢 GREEN
```

---

## Escalation Message Template

### Template 23: Escalating to On-Call Lead

```
🔔 Escalating Incident

Current level: Engineer
Escalating to: On-Call Lead [Name]

Issue: [What's wrong]
Status: [What we've tried]
Time spent: [How long]

Metrics showing:
• Error rate: [X]%
• Latency: [X]ms
• Memory: [X]%
• Logs last 20 lines: [Paste here]

Need help: [Specific question]
```

---

## Celebration Templates

### Template 24: Phase Milestone Celebration

```
🎉 Phase [X] Complete!

Milestone: [What we accomplished]
Date: Aug [Date]
Status: ✅ PERFECT (zero incidents)

By numbers:
• Uptime: 100%
• Errors: 0
• Data loss: 0
• Rollbacks needed: 0

Team effort: [Acknowledge everyone]

Next milestone: [What's coming]
```

---

## Important Notes on Communication

**During Incidents**:
- ✅ Update status every 5 minutes
- ✅ Be honest about severity
- ✅ Give ETA even if uncertain ("unknown, max 1 hour")
- ✅ Escalate early (at 5 min mark if unsure)
- ❌ Don't hide issues or hope they go away
- ❌ Don't communicate via personal messages (use #war-room)

**For Regular Updates**:
- Slack: For real-time updates (typed as-you-go)
- Email: For formal sign-offs (stakeholders, team)
- Dashboard: For metrics (always link, never paste numbers)
- War room: For incidents (join #war-room)

**Tone**:
- Professional but friendly
- Clear and specific (no jargon unless context is clear)
- Honest about status (good news and bad)
- Forward-looking (what's next, not what went wrong)

---

**Template index**:
- Templates 1-5: Phase 2 (Aug 10-11)
- Templates 6-10: Phase 3 Staging (Aug 16-19)
- Templates 11-18: Phase 3 Production (Aug 21-28)
- Templates 19-21: Incident communication
- Templates 22-24: Status & milestones

Use these as-is or customize for your team's style.
