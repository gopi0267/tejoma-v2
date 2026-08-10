# Phase 2: Immediate Next Steps

**Current Status**: Phase 1 Complete (Upload + Resume + Notifications services built)
**Next Action**: Implement Phase 2 (Monolith integration & shadow mode)
**Timeline**: 1 week (Aug 9-15)
**Starting**: Monday, Aug 9

---

## What Phase 2 Does

**Goal**: Keep monolith and new services in sync, validate zero drift, then cutover to production

```
Phase 1 State:          Phase 2 State:           Phase 3 State:
Services built          Dual-write enabled      Feature flags enabled
Feature flags OFF       Shadow mode running     Production cutover
Monolith 100%           Monolith still reads    Services 100%
                        Services synced
```

---

## 5-Step Implementation Plan

### Step 1: Add Dual-Write Hooks (Aug 9-10)

**File**: src/dualWrite.ts

Add three new functions:
```typescript
export function upsertUpload(row: Record<string, unknown>): void { ... }
export function upsertResume(row: Record<string, unknown>): void { ... }
export function upsertNotification(row: Record<string, unknown>): void { ... }
```

**From**: PHASE_2_INTEGRATION_SPEC.md (has complete code)

**Verify**:
```bash
npm run dev
# Create an upload via monolith
# Check tejoma_uploads DB: should have record
# Check monolith DB: should have same record
```

### Step 2: Create Backfill Script (Aug 10-11)

**File**: scripts/backfill-phase2.ts

Load all historical data:
- All uploads from monolith → upload-service
- All resumes from monolith → resume-service
- All notifications from monolith → notifications-service

**Run**:
```bash
npm run backfill:phase2
# Output: "Backfilled 1234 uploads, 567 resumes, 890 notifications"
```

**From**: PHASE_2_INTEGRATION_SPEC.md (has complete code)

### Step 3: Create Validation Script (Aug 11-12)

**File**: scripts/validate-phase2-sync.ts

Verify zero drift:
- Count uploads in both DBs (should match)
- Count resumes in both DBs (should match)
- Count notifications in both DBs (should match)
- Deep-compare random samples

**Run**:
```bash
npm run validate:phase2
# Output: "✅ All validation checks passed - zero drift detected!"
```

**From**: PHASE_2_INTEGRATION_SPEC.md (has complete code)

### Step 4: Enable Dual-Write (Aug 13-14)

**File**: .env.local

Change:
```env
DUAL_WRITE_ENABLED=true
```

**Verify**:
```bash
# Watch logs
tail -f logs/app.log | grep dualWrite
# Should see writes being mirrored

# Create new upload
curl -X POST ... http://localhost:3000/api/uploads ...

# Check both DBs
psql -d tejoma_recruiting -c "SELECT COUNT(*) FROM uploads"  # Should match
psql -d tejoma_uploads -c "SELECT COUNT(*) FROM uploads"     # Should match
```

### Step 5: Run Final Validation (Aug 15)

```bash
npm run validate:phase2
# Should pass with zero drift
```

---

## Complete Code Templates

All code for Phase 2 is in **PHASE_2_INTEGRATION_SPEC.md**:

1. **Dual-write functions** → Copy to src/dualWrite.ts
2. **Backfill script** → Create scripts/backfill-phase2.ts
3. **Validation script** → Create scripts/validate-phase2-sync.ts
4. **A/B parity script** → Create scripts/test-ab-parity.ts

Just copy-paste and customize environment variables.

---

## Phase 2 Deliverables Checklist

- [ ] src/dualWrite.ts updated with 3 new functions
- [ ] Service database pool helpers added
- [ ] Dual-write calls wired in db.ts
- [ ] scripts/backfill-phase2.ts created and tested
- [ ] scripts/validate-phase2-sync.ts created and tested
- [ ] scripts/test-ab-parity.ts created (optional but recommended)
- [ ] DUAL_WRITE_ENABLED=true in .env.local
- [ ] Monitoring logs show dual-writes working
- [ ] Validation passes: zero drift
- [ ] Ready for Phase 3 (cutover)

---

## Phase 2 Success Criteria

✅ **Dual-write working**: Every write to monolith appears in all services
✅ **Backfill complete**: All historical data loaded (counts match)
✅ **Zero drift**: Validation scripts pass (random sampling matches)
✅ **A/B parity**: Old and new endpoints return same responses
✅ **Stable**: 24 hours of operation with no errors
✅ **Monitorable**: Alerts configured for dual-write failures
✅ **Reversible**: Can instantly disable dual-write if needed

---

## How to Know Phase 2 is Ready

When you can answer "YES" to all:

1. "Can I disable dual-write and still have everything work?" → YES
2. "Do both databases have the same row counts?" → YES
3. "Did the backfill script complete without errors?" → YES
4. "Does validation script show zero drift?" → YES
5. "Have I been monitoring for 24 hours with no failures?" → YES
6. "Is my team confident in the rollback procedure?" → YES

Then: **You're ready for Phase 3 (Production Cutover)**

---

## Phase 3: What Happens Next (Preview)

When Phase 2 is done:

```
Phase 3 Timeline:

Aug 16-20: Staging Deployment
├─ Deploy services to staging
├─ Enable all feature flags
├─ Run full test suite
└─ Validate: everything works

Aug 21-23: 10% Production
├─ Enable for 10% of users
├─ Monitor errors & latency
├─ If all good → proceed

Aug 24-26: 50% Production
├─ Enable for 50% of users
├─ Continue monitoring
├─ If all good → proceed

Aug 27-28: 100% Production
├─ Full cutover
├─ Intensive monitoring
├─ On-call team on alert

Aug 29-31: Stabilization
├─ 24-hour validation
├─ Optimization if needed
└─ Production stable ✅
```

---

## Quick Command Reference

```bash
# Phase 2 workflow
npm run backfill:phase2       # Load all historical data
npm run validate:phase2       # Check zero drift
npm run test:ab-parity        # Compare responses
npm run deploy:phase3         # When Phase 2 complete

# Watch logs during dual-write
tail -f logs/app.log | grep -E "upsert|dualWrite"

# Check database sync
psql -c "SELECT COUNT(*) as count FROM uploads" -d tejoma_recruiting
psql -c "SELECT COUNT(*) as count FROM uploads" -d tejoma_uploads
# Both should be identical

# Enable/disable dual-write
# In .env.local:
DUAL_WRITE_ENABLED=true    # Enable mirroring
DUAL_WRITE_ENABLED=false   # Disable mirroring (rollback)
```

---

## Risk: What Could Go Wrong?

### Low Risk (Plan for it):
- Dual-write slower than expected → Add monitoring, optimize
- Backfill takes longer than expected → Run overnight
- Some data types mismatch → Fix mapping, re-backfill

### Medium Risk (Have rollback ready):
- Database connection pool exhausted → Increase pool size, restart
- Dual-write errors accumulate → Disable dual-write, investigate

### High Risk (Unlikely, but test):
- Data corruption discovered → Restore backups, re-backfill
- Service crashes → Health checks restart, instant fallback

### Mitigation:
✅ Dual-write is fire-and-forget (never blocks)
✅ Can disable with single env var change
✅ Validation scripts catch issues early
✅ Backups taken before backfill
✅ Monolith unchanged during shadow phase

---

## Estimated Timeline

| Task | Time | Start Date | End Date |
|------|------|-----------|----------|
| Dual-write hooks | 2 hours | Aug 9 | Aug 9 |
| Backfill script | 2 hours | Aug 9 | Aug 10 |
| Validation script | 2 hours | Aug 10 | Aug 11 |
| Backfill execution | 1-2 hours | Aug 11 | Aug 11 |
| Validation run | 30 mins | Aug 11 | Aug 11 |
| A/B parity test | 1 hour | Aug 12 | Aug 12 |
| Enable dual-write | 30 mins | Aug 13 | Aug 13 |
| 24h monitoring | 24 hours | Aug 13 | Aug 14 |
| Final validation | 1 hour | Aug 15 | Aug 15 |
| **Total** | **~11 hours** | **Aug 9** | **Aug 15** |

---

## Success: After Phase 2 Complete

You'll have:

✅ **Monolith and all 3 new services running in parallel**
✅ **Every write simultaneously on monolith + services**
✅ **All data synchronized (proven by validation)**
✅ **A/B parity confirmed (responses identical)**
✅ **Zero drift validated**
✅ **24+ hours stable operation**
✅ **Confidence for Phase 3 cutover**

And you can still:
- ✅ Instantly rollback (disable dual-write)
- ✅ Run validation again (confirms sync)
- ✅ Test services independently (Feature flags off)

---

## Starting Monday

```
Aug 9 (Monday):
08:00 - Add dual-write hooks to src/dualWrite.ts
10:00 - Wire up calls in db.ts
12:00 - Test: create upload, verify in both DBs
14:00 - Create backfill-phase2.ts script
16:00 - Create validation-phase2.ts script
18:00 - Ready for Aug 10

Aug 10 (Tuesday):
09:00 - Run backfill script (load all historical data)
12:00 - Create A/B parity test
14:00 - Run validation (should show zero drift)
16:00 - All Phase 2 prep done, ready to enable

Aug 13-15 (Fri-Sun):
Enable dual-write, monitor for 48h
Final validation passes
Ready for Phase 3 ✅
```

---

## Reference Documents

1. **PHASE_2_INTEGRATION_SPEC.md** ← Complete code & procedures
2. **PHASE_2_3_ROADMAP.md** ← Full 4-week timeline
3. **PHASE_1_COMPLETE_SUMMARY.md** ← What's already done
4. **PHASE_1_IMPLEMENTATION_CHECKLIST.md** ← Task reference

---

## Questions to Ask Before Starting

- [ ] Are all Phase 1 services tested locally?
- [ ] Do I have database backups?
- [ ] Is my team trained on dual-write concept?
- [ ] Do I have monitoring/alerting in place?
- [ ] Is on-call team aware of timeline?
- [ ] Do I have production runbook ready?

If all YES → Ready to start Phase 2 ✅

---

**Status**: Phase 2 Ready to Implement
**Start Date**: Monday, Aug 9
**Estimated Completion**: Friday, Aug 15
**Next Phase**: Phase 3 Production Cutover (Aug 16+)

You have all the code. Just follow the step-by-step guide in PHASE_2_INTEGRATION_SPEC.md
