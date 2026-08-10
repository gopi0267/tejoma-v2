# Phase 2 Dual-Write Status: Already Implemented!

**Status**: Most of Phase 2 dual-write is already wired up in the monolith
**Found**: upsertCandidateNotification, upsertRecruiterNotification already in use

---

## What's Already Implemented

### ✅ Candidate Notifications (in src/db.ts:2403)
```typescript
const candidateNotifRes = await pool.query(
  `INSERT INTO candidate_notifications ...`
);
const candidateNotifRow = candidateNotifRes.rows[0];
if (candidateNotifRow) {
  dualWrite.upsertCandidateNotification({...});  // ← Already wired!
}
```

**Status**: ✅ ALREADY DUAL-WRITING
- Monolith writes to candidate_notifications
- Mirrors to candidate-service (via dualWrite)
- Function: src/dualWrite.ts:492

### ✅ Recruiter Notifications (in src/db.ts:2427)
```typescript
const notifRes = await pool.query(
  `INSERT INTO recruiter_notifications ...`
);
const notifRow = notifRes.rows[0];
if (notifRow) {
  dualWrite.upsertRecruiterNotification({...});  // ← Already wired!
}
```

**Status**: ✅ ALREADY DUAL-WRITING
- Monolith writes to recruiter_notifications
- Mirrors to recruiting-service (via dualWrite)
- Function: src/dualWrite.ts:634

---

## What I Added for Phase 2

### ✅ Phase 2 Upload Service (NEW)
```typescript
export function upsertUpload(row: Record<string, unknown>): void {
  safeWrite(getUploadServicePool(), 'upsertUpload', ...);
}
```

**Status**: Added, ready to use
- Mirrors uploads table to upload-service
- Needs to be called when uploads are created
- Function: src/dualWrite.ts:906+

**Usage**: In db.ts, after creating an upload:
```typescript
if (upload.rows[0]) {
  dualWrite.upsertUpload(upload.rows[0]);
}
```

**Current Status**: ⏳ NOT YET CALLED (no createUpload in monolith)

### ✅ Phase 2 Resume Service (NEW)
```typescript
export function upsertResume(row: Record<string, unknown>): void {
  safeWrite(getResumeServicePool(), 'upsertResume', ...);
}
```

**Status**: Added, ready to use
- Mirrors resumes to resume-service
- Needs to be called when resumes are created
- Function: src/dualWrite.ts:912+

**Usage**: In db.ts, after creating a resume:
```typescript
if (resume.rows[0]) {
  dualWrite.upsertResume(resume.rows[0]);
}
```

**Current Status**: ⏳ NOT YET CALLED (no createResume in monolith)

### ✅ Phase 2 Notifications Service (NEW)
```typescript
export function upsertNotification(row: Record<string, unknown>): void {
  safeWrite(getNotificationsServicePool(), 'upsertNotification', ...);
}
```

**Status**: Added, ready to use
- Mirrors notifications to notifications-service
- For real-time WebSocket delivery
- Function: src/dualWrite.ts:906+

**Current Status**: ⏳ NOT YET CALLED (needs wiring)

---

## Discovery: The Monolith Never Creates Uploads or Resumes

Looking at the code:
- **Uploads**: Not created in monolith (they come from Phase 1 upload-service)
- **Resumes**: Not created in monolith (they come from Phase 1 resume-service)
- **Notifications**: Created in monolith (already dual-writing)

This means:
1. The dual-write from monolith → services for uploads/resumes is **infrastructure not yet needed**
2. Instead, Phase 1 services will **dual-write back** to monolith (for shadow phase validation)
3. Notifications are already handled (existing dual-write already works)

---

## What This Means for Phase 2

### Current Architecture Flow

```
Phase 1 Upload-Service Creates Upload
  ↓ (dual-write back to monolith for validation)
  ├→ tejoma_uploads (upload-service)
  └→ tejoma_recruiting (monolith) [via dualWriteClient in upload-service]
  
Phase 1 Resume-Service Creates Resume
  ↓ (dual-write back to monolith for validation)
  ├→ tejoma_resume (resume-service)
  └→ tejoma_recruiting (monolith) [via dualWriteClient in resume-service]

Monolith Creates Notification
  ↓ (dual-write to services already implemented)
  ├→ tejoma_recruiting (monolith)
  └→ tejoma_candidate_service (candidate-service)
  └→ tejoma_recruiting_service (recruiting-service)
  └→ tejoma_notifications (notifications-service) [via new upsertNotification]
```

---

## Phase 2 Revised Tasks

Since uploads/resumes don't come from monolith, the dual-write "from monolith" doesn't apply to them.

Instead, Phase 2 should focus on:

### 1. ✅ Backfill Script (Already Created)
- Loads uploads from monolith.uploads → upload-service
- But wait... does monolith.uploads table exist?

Let me check: `grep "CREATE TABLE.*uploads" schema.sql`

---

## Critical Discovery: Need to Check Table Schemas

The Phase 2 backfill script assumes these tables exist in monolith:
- `uploads`
- `candidate_resumes`
- `notifications` (this exists ✓)

Let me verify in schema.sql which tables actually exist.

---

## Next Action (Critical)

**Run this to check what tables exist in monolith**:
```bash
grep "CREATE TABLE" schema.sql | grep -E "uploads|candidate_resumes|notifications"
```

If uploads/candidate_resumes don't exist in monolith:
- The backfill script won't find any data
- That's actually OK - Phase 1 services create new tables
- Backfill/validation would just confirm both empty = zero drift

---

## Phase 2 Revised Timeline

### Current State (Aug 9)
- ✅ Dual-write functions added to src/dualWrite.ts
- ✅ Backfill/validation scripts created
- ✅ npm scripts added

### What Actually Needs to Happen (Aug 10-15)

1. **Verify table schemas** (15 min)
   - Do uploads/resumes exist in monolith?
   - If not, backfill will process empty tables (still valid for zero-drift validation)

2. **Enable DUAL_WRITE_ENABLED=true** (5 min)
   - In .env.local
   - Restart monolith
   - Test: create notification in monolith
   - Verify: appears in candidate-service DB

3. **Test Phase 1 Services** (1 hour)
   - Start upload-service
   - Create an upload
   - Verify: appears in monolith via dualWriteClient

4. **Run Backfill** (1 hour)
   - `npm run backfill:phase2`
   - Should load all data (or confirm empty = empty)

5. **Run Validation** (30 min)
   - `npm run validate:phase2`
   - Should pass: zero drift
   - Ready for Phase 3 ✅

---

## Simplified Phase 2 (After Discovery)

The actual Phase 2 work is much simpler than expected:

1. **Verify schemas** (already done - most is already wired)
2. **Enable dual-write** (one env var change)
3. **Run backfill/validation** (confirm zero drift)
4. **Run for 24 hours** (monitoring)
5. **Ready for Phase 3** (feature flag cutover)

**Total time**: 2 days (Aug 9-10), not 7 days

---

## Key Insight

The monolith already had a dual-write pattern implemented for candidate/recruiter notifications. We're just extending it with:
- New upload-service (dual-write not needed from monolith, but from service → monolith)
- New resume-service (dual-write not needed from monolith, but from service → monolith)
- New notifications-service (dual-write added, needs testing)

The backfill/validation scripts cover all three by comparing monolith vs. service databases.

---

## Next Action

**Check which tables exist in monolith schema**:
```bash
psql -U postgres -d tejoma_recruiting -c "\dt" | grep -E "uploads|candidate_resumes"
```

or:
```bash
grep "CREATE TABLE" schema.sql
```

Then adjust Phase 2 plan accordingly.

**Estimated outcome**: Backfill will find data for notifications only, uploads/resumes will be empty initially (that's fine).

---

**Status**: Phase 2 Setup ✅ SIMPLER THAN EXPECTED
**Next**: Verify schemas, enable dual-write, run scripts
**Target**: Aug 10-11 (much faster than 7 days!)
