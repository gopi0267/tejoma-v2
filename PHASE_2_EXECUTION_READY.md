# Phase 2 Execution: Ready Now! ✅

**Status**: All infrastructure is in place and enabled
**DUAL_WRITE_ENABLED**: Already set to `true` in .env.local
**Next**: Run backfill and validation scripts

---

## Current State

✅ DUAL_WRITE_ENABLED=true
✅ Dual-write functions added to src/dualWrite.ts
✅ Service pools configured
✅ Backfill script ready
✅ Validation script ready

---

## Phase 2 Execution (3 Commands)

### Command 1: Backfill Historical Data

```bash
npm run backfill:phase2
```

**What it does**:
- Connects to monolith (tejoma_recruiting)
- Connects to upload-service (tejoma_uploads)
- Connects to resume-service (tejoma_resume)
- Connects to notifications-service (tejoma_notifications)
- Loads all data from monolith → services
- Shows counts for verification

**Expected output**:
```
Backfilling uploads...
Found 0 uploads to backfill
✓ Backfilled 0 uploads

Backfilling resumes...
Found 0 resumes to backfill
✓ Backfilled 0 resumes

Backfilling notifications...
Found ~1500 notifications to backfill
✓ Backfilled 1500 notifications

========================================
Phase 2 Backfill Complete
========================================
Uploads:       0
Resumes:       0
Notifications: 1500
========================================
Next: Run validation script to check for zero drift
```

**Exit code**: 0 (success)

---

### Command 2: Validate Zero Drift

```bash
npm run validate:phase2
```

**What it does**:
- Counts rows in monolith vs. services
- Deep-compares random samples (5 rows each)
- Reports zero drift = success

**Expected output**:
```
Checking uploads...
✓ Upload counts match: 0

Checking resumes...
✓ Resume counts match: 0

Checking notifications...
✓ Notification counts match: 1500

Checking samples...
✓ All samples match

========================================
✅ VALIDATION PASSED - ZERO DRIFT DETECTED
========================================
Uploads:       0 (matched)
Resumes:       0 (matched)
Notifications: 1500 (matched)
========================================
All Phase 2 databases are in sync!
```

**Exit code**: 0 (success) or 1 (drift found)

---

### Command 3: Monitor (24 Hours)

```bash
# Watch for dual-write errors
tail -f logs/app.log | grep -E "upsert|dualWrite|error"
```

**What to look for**:
- ✅ Successful upserts (reassuring)
- ✅ No errors (good)
- ❌ Repeated failures (problem - investigate)

**After 24 hours without errors**: Ready for Phase 3

---

## Phase 2 Complete Checklist

- [x] DUAL_WRITE_ENABLED=true (already set)
- [x] Dual-write functions added
- [x] Service pools configured
- [x] Backfill script ready
- [x] Validation script ready
- [ ] Run: npm run backfill:phase2
- [ ] Verify: Shows 0 uploads, 0 resumes, ~1500 notifications
- [ ] Run: npm run validate:phase2
- [ ] Verify: "✅ VALIDATION PASSED - ZERO DRIFT DETECTED"
- [ ] Monitor: 24 hours of logs (zero errors)
- [ ] Ready for Phase 3 ✅

---

## What Happens During Backfill

**Uploads & Resumes**: 
- Backfill finds 0 in monolith (expected - Phase 1 services create them)
- Service databases start empty
- Zero drift confirmed ✓

**Notifications**:
- Backfill finds ~1500 in monolith
- Copies to notifications-service
- Both databases now have same data
- Zero drift confirmed ✓

**Result**: All databases in perfect sync for shadow phase

---

## What Happens During Validation

**Step 1: Count validation**
```
Monolith notifications: 1500
Service notifications:  1500
✓ Counts match
```

**Step 2: Deep-compare samples**
```
Compare 5 random notifications:
✓ Row 1 matches
✓ Row 2 matches
✓ Row 3 matches
✓ Row 4 matches
✓ Row 5 matches
```

**Step 3: Report**
```
✅ ZERO DRIFT DETECTED
All systems in sync, ready for cutover
```

---

## If Validation Fails

**If counts don't match**:
1. Check database connections (can reach all 3?)
2. Check DUAL_WRITE_ENABLED=true
3. Check logs for errors
4. Rerun backfill: `npm run backfill:phase2`
5. Rerun validation: `npm run validate:phase2`

**If samples don't match**:
1. Identify which table has drift
2. Check if monolith has recent writes
3. Run backfill again (idempotent)
4. Run validation again

**Last resort**: Disable and investigate
```bash
DUAL_WRITE_ENABLED=false
# (investigate root cause)
DUAL_WRITE_ENABLED=true
# (retry)
```

---

## Timeline (Aug 10-11)

### Aug 10 (Today)
- [ ] 09:00 - Run backfill: `npm run backfill:phase2`
- [ ] 09:05 - Run validation: `npm run validate:phase2`
- [ ] 09:10 - Verify output (should show zero drift)
- [ ] Done! ✅

### Aug 11 (Tomorrow)
- [ ] Monitor logs (should be clean)
- [ ] No errors = proceed to Phase 3
- [ ] Errors = investigate and fix

### Aug 12+
- [ ] Ready for Phase 3 (production cutover)

---

## Phase 3 is Next

Once Phase 2 validation passes:

1. **Staging** (Aug 16-20)
   - Deploy services to staging
   - Enable feature flags
   - Load test
   - Rollback drill

2. **Production** (Aug 21-28)
   - 10% rollout (Aug 21-23)
   - 50% rollout (Aug 24-26)
   - 100% rollout (Aug 27-28)
   - Stabilization (Aug 29-31)

All procedures documented in PHASE_2_3_ROADMAP.md

---

## Summary

**Phase 2 is essentially complete!**

Just 3 commands to execute:
1. `npm run backfill:phase2`
2. `npm run validate:phase2`
3. Monitor logs for 24h

Expected: Both pass, zero drift, ready to cutover

**When validation passes**: Phase 3 production cutover begins

---

**Status**: Phase 2 ✅ READY TO EXECUTE
**Next**: Run the 3 commands above
**Expected result**: Zero drift confirmed, ready for production
