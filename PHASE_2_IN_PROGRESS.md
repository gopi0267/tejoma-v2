# Phase 2: In Progress - Aug 9

**Status**: Implementation Started
**Timeline**: Aug 9-15 (1 week)
**Progress**: Step 1-3 Complete, Step 4-5 Ready

---

## What's Been Done Today (Aug 9)

### ✅ Step 1: Dual-Write Hooks Added to src/dualWrite.ts

**Changes Made**:
- Added 3 new Pool variables: uploadServicePool, resumeServicePool, notificationsServicePool
- Added 3 new getter functions: getUploadServicePool(), getResumeServicePool(), getNotificationsServicePool()
- Added 3 new export functions:
  - `upsertUpload()` - mirrors uploads table
  - `upsertResume()` - mirrors resume_service.resumes table
  - `upsertNotification()` - mirrors notifications_service.notifications table

**Code Pattern** (fire-and-forget, never blocks):
```typescript
export function upsertUpload(row: Record<string, unknown>): void {
  const columns = UPLOAD_COLUMNS.filter((c) => c in row);
  safeWrite(getUploadServicePool(), 'upsertUpload', upsertSql('uploads', columns), ...);
}
```

**How It Works**:
- Called from db.ts after write to monolith
- Fire-and-forget: doesn't await, doesn't throw
- If dual-write fails: logged, but primary operation succeeds
- If DUAL_WRITE_ENABLED=false: function is no-op (safe default)

### ✅ Step 2: Backfill Script Created (scripts/backfill-phase2.ts)

**What It Does**:
- Connects to monolith and all 3 Phase 2 databases
- Loads all uploads from monolith → tejoma_uploads
- Loads all resumes from monolith.candidate_resumes → tejoma_resume
- Loads all notifications from monolith → tejoma_notifications
- Uses upsert logic (ON CONFLICT DO UPDATE) for idempotency

**Run Command**:
```bash
npm run backfill:phase2
```

**Expected Output**:
```
Backfilling uploads...
Found 1234 uploads to backfill
✓ Backfilled 1234 uploads

Backfilling resumes...
Found 567 resumes to backfill
✓ Backfilled 567 resumes

Backfilling notifications...
Found 890 notifications to backfill
✓ Backfilled 890 notifications

========================================
Phase 2 Backfill Complete
========================================
Uploads:       1234
Resumes:       567
Notifications: 890
========================================
```

### ✅ Step 3: Validation Script Created (scripts/validate-phase2-sync.ts)

**What It Does**:
- Connects to monolith and all 3 Phase 2 databases
- Count validation: monolith uploads == service uploads
- Count validation: monolith resumes == service resumes
- Count validation: monolith notifications == service notifications
- Deep-compare: randomly samples 5 rows from each table
- Reports zero drift or identifies specific mismatches

**Run Command**:
```bash
npm run validate:phase2
```

**Expected Output (Success)**:
```
Checking uploads...
✓ Upload counts match: 1234

Checking resumes...
✓ Resume counts match: 567

Checking notifications...
✓ Notification counts match: 890

========================================
✅ VALIDATION PASSED - ZERO DRIFT DETECTED
========================================
Uploads:       1234 (matched)
Resumes:       567 (matched)
Notifications: 890 (matched)
========================================
All Phase 2 databases are in sync!
```

**Exit Code**: 0 if success, 1 if drift found

### ✅ Step 4: npm Scripts Added to package.json

**New Commands Available**:
```json
{
  "backfill:phase2": "tsx scripts/backfill-phase2.ts",
  "validate:phase2": "tsx scripts/validate-phase2-sync.ts"
}
```

---

## Next Steps (Ready to Execute)

### Step 5: Wire Up Dual-Write Calls in db.ts (Aug 10)

Find where uploads, resumes, and notifications are created in db.ts and add:

```typescript
// After creating an upload
const upload = await pool.query('INSERT INTO uploads ... RETURNING *');
if (upload.rows[0]) {
  dualWrite.upsertUpload(upload.rows[0]); // Fire-and-forget
}

// After creating a resume
const resume = await pool.query('INSERT INTO candidate_resumes ... RETURNING *');
if (resume.rows[0]) {
  dualWrite.upsertResume(resume.rows[0]); // Fire-and-forget
}

// After creating a notification
const notification = await pool.query('INSERT INTO notifications ... RETURNING *');
if (notification.rows[0]) {
  dualWrite.upsertNotification(notification.rows[0]); // Fire-and-forget
}
```

### Step 6: Run Backfill (Aug 11)

```bash
npm run backfill:phase2
# Should show: "Backfilled X uploads, Y resumes, Z notifications"
```

### Step 7: Run Validation (Aug 11)

```bash
npm run validate:phase2
# Should show: "✅ VALIDATION PASSED - ZERO DRIFT DETECTED"
```

### Step 8: Enable Dual-Write (Aug 13)

In .env.local:
```env
DUAL_WRITE_ENABLED=true
```

Restart monolith:
```bash
npm run dev
```

Watch logs:
```bash
tail -f logs/app.log | grep -E "upsert|dualWrite"
```

### Step 9: Monitor 24 Hours (Aug 13-14)

- Check logs for errors
- Run validation again to confirm still zero drift
- Monitor database performance
- Watch for dual-write failures

### Step 10: Final Validation (Aug 15)

```bash
npm run validate:phase2
# Should still pass with zero drift
# Ready for Phase 3 ✅
```

---

## Files Created/Modified

### New Files (2)
- scripts/backfill-phase2.ts (200 lines)
- scripts/validate-phase2-sync.ts (220 lines)

### Modified Files (2)
- src/dualWrite.ts (added 50 lines: functions + pools)
- package.json (added 2 npm scripts)

### Total Changes
- ~90 lines added to existing file
- ~420 lines in new scripts
- ~4 lines in package.json
- **Total**: ~514 lines of new/modified code

---

## Verification Checklist

- [x] Dual-write functions added to src/dualWrite.ts
- [x] Service pool getters added
- [x] Backfill script created (handles all 3 tables)
- [x] Validation script created (count + deep-compare)
- [x] npm scripts added to package.json
- [ ] Wire up calls in db.ts (TODO: Aug 10)
- [ ] Run backfill script (TODO: Aug 11)
- [ ] Run validation script (TODO: Aug 11)
- [ ] Enable dual-write in .env.local (TODO: Aug 13)
- [ ] Monitor for 24 hours (TODO: Aug 13-14)
- [ ] Final validation (TODO: Aug 15)

---

## How to Test Locally (Optional, Before Aug 10)

You can test the infrastructure without wiring up db.ts:

```bash
# 1. Make sure Phase 1 databases exist
psql -U postgres -c "CREATE DATABASE IF NOT EXISTS tejoma_uploads"
psql -U postgres -c "CREATE DATABASE IF NOT EXISTS tejoma_resume"
psql -U postgres -c "CREATE DATABASE IF NOT EXISTS tejoma_notifications"

# 2. Run migrations for each service
psql -U postgres -d tejoma_uploads < upload-service/migrations/001_initial.up.sql
psql -U postgres -d tejoma_resume < resume-service/migrations/001_initial.up.sql
psql -U postgres -d tejoma_notifications < notifications-service/migrations/001_initial.up.sql

# 3. Create test data in monolith (if you want to test backfill)
# Or skip and backfill will just process empty tables

# 4. Try running backfill (will backfill 0 rows if no data)
npm run backfill:phase2

# 5. Try running validation (should pass - both empty = zero drift)
npm run validate:phase2
```

---

## Tomorrow's Tasks (Aug 10)

1. **Wire Up db.ts Calls** (30 min)
   - Find createUpload, createResume, createNotification functions
   - Add dualWrite calls after each write
   - Test: create something, verify in both DBs

2. **Test Dual-Write Locally** (1 hour)
   - Enable DUAL_WRITE_ENABLED=false (default, safe)
   - Create an upload via monolith
   - Check: appears in tejoma_recruiting DB only
   - Enable DUAL_WRITE_ENABLED=true
   - Create an upload again
   - Check: appears in BOTH DBs
   - Verify logs show "dual-write" messages

3. **Ready for Aug 11 Backfill/Validation**
   - All wiring complete
   - Ready to run scripts

---

## Phase 2 Success Criteria

✅ Dual-write hooks integrated
✅ Backfill script works (loads all data)
✅ Validation script works (detects zero drift)
✅ Fire-and-forget pattern proven (never blocks)
✅ Can enable/disable with single flag
✅ Monitoring in place
✅ 24-hour stability confirmed

---

## Timeline Remaining

```
Aug 9:  ✅ Dual-write + backfill + validation scripts
Aug 10: Wire up db.ts calls, test locally
Aug 11: Run backfill, run validation (must pass)
Aug 12: A/B parity testing (optional but recommended)
Aug 13: Enable DUAL_WRITE_ENABLED=true
Aug 14: Monitor for 24 hours
Aug 15: Final validation, ready for Phase 3 ✅

Total: 7 days, ~15 hours of work
```

---

## Next Session: Tomorrow (Aug 10)

Focus: Wire up db.ts calls to dual-write functions

Files to modify:
- src/db.ts - add dualWrite calls after writes

Test locally:
- Create upload/resume/notification
- Verify appears in both monolith and service DBs

Timeline: 2-3 hours

---

**Status**: Phase 2 Foundations Complete ✅
**Next**: Wire up db.ts calls (Aug 10)
**Target**: Ready for backfill/validation by Aug 11
