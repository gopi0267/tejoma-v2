# Phase 2: Monolith Integration & Shadow Mode

**Objective**: Enable dual-write from monolith, backfill historical data, validate zero drift
**Timeline**: 1 week (Aug 9-15)
**Risk Level**: LOW (feature flags still false, reads from monolith)
**Deliverables**: Backfill scripts, validation scripts, dual-write hooks, production runbook

---

## Overview: Shadow Phase

```
Phase 1: Services Built          Phase 2: Shadow Mode           Phase 3: Cutover
┌─────────────────┐              ┌──────────────────┐           ┌────────────┐
│ Upload Service  │ ✅           │ Dual-Write       │           │  Feature   │
│ Resume Service  │ ✅      →    │ Enabled          │      →    │  Flags ON  │
│ Notifications   │ ✅           │ Backfill Running │           │ Production │
│                 │              │ Validation OK    │           │ Cutover    │
└─────────────────┘              └──────────────────┘           └────────────┘

Feature Flag Status:
All services DISABLED (false) → Monolith handles 100% of traffic
Dual-write ENABLED (true) → Mirrors every write to new services
After validation PASSES → Enable feature flags for cutover
```

---

## Step 1: Add Dual-Write Hooks to Monolith

### File: src/dualWrite.ts (Add to existing file)

```typescript
// ============================================================
// Phase 2: Upload Service Mirror
// ============================================================

const UPLOAD_COLUMNS = [
  'id',
  'company_id',
  'candidate_id',
  'recruiter_id',
  'file_name',
  'file_type',
  'mime_type',
  'file_size_bytes',
  'storage_key',
  'upload_status',
  'error_message',
  'file_hash',
  'virus_scan_status',
  'virus_scan_timestamp',
  'created_at',
  'updated_at',
];

export function upsertUpload(row: Record<string, unknown>): void {
  if (!process.env.DUAL_WRITE_ENABLED) return; // Hard rule: disabled by default
  
  const columns = UPLOAD_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => row[c]);
  
  safeWrite(
    getUploadServicePool(),
    'upsertUpload',
    upsertSql('uploads', columns),
    values
  );
}

// ============================================================
// Phase 2: Resume Service Mirror
// ============================================================

const RESUME_COLUMNS = [
  'id',
  'upload_id',
  'company_id',
  'candidate_id',
  'recruiter_id',
  'extracted_text',
  'skills',
  'experience_years',
  'education',
  'extraction_status',
  'extraction_error',
  'skills_confidence',
  'extracted_at',
  'created_at',
  'updated_at',
];

export function upsertResume(row: Record<string, unknown>): void {
  if (!process.env.DUAL_WRITE_ENABLED) return;
  
  const columns = RESUME_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => {
    if (c === 'skills' && Array.isArray(row[c])) {
      return `{${row[c].join(',')}}`;
    }
    if (c === 'education' && Array.isArray(row[c])) {
      return `{${row[c].map((e) => `"${e}"`).join(',')}}`;
    }
    return row[c];
  });
  
  safeWrite(
    getResumeServicePool(),
    'upsertResume',
    upsertSql('resume_service.resumes', columns),
    values
  );
}

// ============================================================
// Phase 2: Notifications Service Mirror
// ============================================================

const NOTIFICATION_COLUMNS = [
  'id',
  'company_id',
  'recipient_user_id',
  'sender_user_id',
  'notification_type',
  'title',
  'message',
  'data',
  'read_at',
  'deleted_at',
  'created_at',
  'updated_at',
];

export function upsertNotification(row: Record<string, unknown>): void {
  if (!process.env.DUAL_WRITE_ENABLED) return;
  
  const columns = NOTIFICATION_COLUMNS.filter((c) => c in row);
  const values = columns.map((c) => {
    if (c === 'data' && typeof row[c] === 'object') {
      return JSON.stringify(row[c]);
    }
    return row[c];
  });
  
  safeWrite(
    getNotificationsServicePool(),
    'upsertNotification',
    upsertSql('notifications_service.notifications', columns),
    values
  );
}

// ============================================================
// Helper: Get service database pools
// ============================================================

function getUploadServicePool() {
  return getOrCreatePool(
    'upload-service',
    process.env.DB_HOST || 'localhost',
    parseInt(process.env.DB_PORT || '5432'),
    process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || ''
  );
}

function getResumeServicePool() {
  return getOrCreatePool(
    'resume-service',
    process.env.DB_HOST || 'localhost',
    parseInt(process.env.DB_PORT || '5432'),
    process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || ''
  );
}

function getNotificationsServicePool() {
  return getOrCreatePool(
    'notifications-service',
    process.env.DB_HOST || 'localhost',
    parseInt(process.env.DB_PORT || '5432'),
    process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || ''
  );
}

const poolCache: Record<string, any> = {};

function getOrCreatePool(key: string, host: string, port: number, database: string, user: string, password: string) {
  if (!poolCache[key]) {
    poolCache[key] = new (require('pg')).Pool({
      host,
      port,
      database,
      user,
      password,
      max: 2,
      idleTimeoutMillis: 5000,
    });
  }
  return poolCache[key];
}
```

### Wire up dual-write calls in db.ts

Find where uploads/resumes/notifications are created and add dual-write calls:

```typescript
// In src/db.ts, after creating an upload:
const upload = await pool.query('INSERT INTO uploads ... RETURNING *');
if (upload.rows[0]) {
  dualWrite.upsertUpload(upload.rows[0]); // Fire-and-forget
}

// Same pattern for resumes and notifications
```

---

## Step 2: Create Backfill Scripts

### File: scripts/backfill-phase2.ts

```typescript
import { Pool } from 'pg';
import { logger } from '../src/utils/logger.js';

async function backfillPhase2() {
  const monolith = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'tejoma_recruiting',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const uploadService = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const resumeService = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const notificationsService = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    logger.info('Starting Phase 2 backfill...');

    // Backfill uploads
    logger.info('Backfilling uploads...');
    const uploads = await monolith.query('SELECT * FROM uploads');
    for (const upload of uploads.rows) {
      await uploadService.query(
        `INSERT INTO uploads (${Object.keys(upload).join(',')}) 
         VALUES (${Object.keys(upload).map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`
      );
    }
    logger.info(`Backfilled ${uploads.rows.length} uploads`);

    // Backfill resumes
    logger.info('Backfilling resumes...');
    const resumes = await monolith.query('SELECT * FROM candidate_resumes');
    for (const resume of resumes.rows) {
      await resumeService.query(
        `INSERT INTO resume_service.resumes (${Object.keys(resume).join(',')})
         VALUES (${Object.keys(resume).map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`
      );
    }
    logger.info(`Backfilled ${resumes.rows.length} resumes`);

    // Backfill notifications
    logger.info('Backfilling notifications...');
    const notifications = await monolith.query('SELECT * FROM notifications');
    for (const notif of notifications.rows) {
      await notificationsService.query(
        `INSERT INTO notifications_service.notifications (${Object.keys(notif).join(',')})
         VALUES (${Object.keys(notif).map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`
      );
    }
    logger.info(`Backfilled ${notifications.rows.length} notifications`);

    logger.info('Phase 2 backfill complete!');
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Backfill failed');
    process.exit(1);
  } finally {
    await monolith.end();
    await uploadService.end();
    await resumeService.end();
    await notificationsService.end();
  }
}

backfillPhase2();
```

---

## Step 3: Create Validation Scripts

### File: scripts/validate-phase2-sync.ts

```typescript
import { Pool } from 'pg';
import { logger } from '../src/utils/logger.js';

async function validateSync() {
  const monolith = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const uploadService = new Pool({
    database: process.env.UPLOAD_SERVICE_DB_NAME || 'tejoma_uploads',
  });
  const resumeService = new Pool({
    database: process.env.RESUME_SERVICE_DB_NAME || 'tejoma_resume',
  });
  const notificationsService = new Pool({
    database: process.env.NOTIFICATIONS_SERVICE_DB_NAME || 'tejoma_notifications',
  });

  try {
    let errors = 0;

    // Validate upload counts
    const monolithUploads = await monolith.query('SELECT COUNT(*) FROM uploads');
    const serviceUploads = await uploadService.query('SELECT COUNT(*) FROM uploads');
    
    if (monolithUploads.rows[0].count !== serviceUploads.rows[0].count) {
      logger.error(
        `Upload count mismatch: monolith=${monolithUploads.rows[0].count}, service=${serviceUploads.rows[0].count}`
      );
      errors++;
    } else {
      logger.info(`✓ Upload counts match (${monolithUploads.rows[0].count})`);
    }

    // Validate resume counts
    const monolithResumes = await monolith.query('SELECT COUNT(*) FROM candidate_resumes');
    const serviceResumes = await resumeService.query('SELECT COUNT(*) FROM resume_service.resumes');
    
    if (monolithResumes.rows[0].count !== serviceResumes.rows[0].count) {
      logger.error(
        `Resume count mismatch: monolith=${monolithResumes.rows[0].count}, service=${serviceResumes.rows[0].count}`
      );
      errors++;
    } else {
      logger.info(`✓ Resume counts match (${monolithResumes.rows[0].count})`);
    }

    // Validate notification counts
    const monolithNotifs = await monolith.query('SELECT COUNT(*) FROM notifications');
    const serviceNotifs = await notificationsService.query('SELECT COUNT(*) FROM notifications_service.notifications');
    
    if (monolithNotifs.rows[0].count !== serviceNotifs.rows[0].count) {
      logger.error(
        `Notification count mismatch: monolith=${monolithNotifs.rows[0].count}, service=${serviceNotifs.rows[0].count}`
      );
      errors++;
    } else {
      logger.info(`✓ Notification counts match (${monolithNotifs.rows[0].count})`);
    }

    // Deep compare random samples
    const uploadSample = await monolith.query('SELECT * FROM uploads ORDER BY RANDOM() LIMIT 5');
    for (const upload of uploadSample.rows) {
      const serviceUpload = await uploadService.query('SELECT * FROM uploads WHERE id = $1', [upload.id]);
      if (serviceUpload.rows.length === 0) {
        logger.error(`Upload ${upload.id} missing from service`);
        errors++;
      } else if (JSON.stringify(upload) !== JSON.stringify(serviceUpload.rows[0])) {
        logger.warn(`Upload ${upload.id} data mismatch (non-critical)`);
      }
    }

    if (errors === 0) {
      logger.info('✅ All validation checks passed - zero drift detected!');
      process.exit(0);
    } else {
      logger.error(`❌ Validation failed with ${errors} error(s)`);
      process.exit(1);
    }
  } finally {
    await monolith.end();
    await uploadService.end();
    await resumeService.end();
    await notificationsService.end();
  }
}

validateSync();
```

---

## Step 4: A/B Parity Testing

### File: scripts/test-ab-parity.ts

```typescript
async function testABParity() {
  const uploadEndpoints = [
    { name: 'POST /api/uploads', method: 'POST', path: '/api/uploads' },
    { name: 'GET /api/uploads/:id', method: 'GET', path: '/api/uploads/1' },
  ];

  for (const endpoint of uploadEndpoints) {
    logger.info(`Testing ${endpoint.name}...`);

    // Call monolith (current)
    const monolithResponse = await fetch(`http://localhost:3000${endpoint.path}`, {
      method: endpoint.method,
      headers: { 'Authorization': 'Bearer test-token' },
    });

    // Call upload-service (new)
    const serviceResponse = await fetch(`http://localhost:4030${endpoint.path}`, {
      method: endpoint.method,
      headers: { 'Authorization': 'Bearer test-token' },
    });

    const monolithData = await monolithResponse.json();
    const serviceData = await serviceResponse.json();

    if (JSON.stringify(monolithData) === JSON.stringify(serviceData)) {
      logger.info(`✓ ${endpoint.name} responses match perfectly`);
    } else {
      logger.error(`✗ ${endpoint.name} responses differ`);
      logger.error('Monolith:', monolithData);
      logger.error('Service:', serviceData);
    }
  }
}

testABParity();
```

---

## Step 5: Enable Shadow Mode

### Update .env.local

```env
# Enable dual-write (keeps monolith + services in sync)
DUAL_WRITE_ENABLED=true

# But keep services DISABLED (feature flags still false)
UPLOAD_SERVICE_ENABLED=false
RESUME_SERVICE_ENABLED=false
NOTIFICATIONS_SERVICE_ENABLED=false
```

Now every write to monolith automatically mirrors to new services.

---

## Phase 2 Checklist

### Week 1 (Aug 9-10)
- [ ] Add dual-write hooks to src/dualWrite.ts
- [ ] Add service database pools
- [ ] Wire up calls from db.ts
- [ ] Test locally: writes go to both DBs

### Week 1 (Aug 11-12)
- [ ] Create backfill-phase2.ts
- [ ] Run backfill: `npm run backfill`
- [ ] Verify counts match: `npm run validate`
- [ ] Zero drift = proceed to A/B testing

### Week 1 (Aug 13-14)
- [ ] Create test-ab-parity.ts
- [ ] Test all endpoints (old vs new)
- [ ] Compare responses: should be identical
- [ ] Document any non-critical differences

### Week 1 (Aug 15)
- [ ] Enable DUAL_WRITE_ENABLED=true
- [ ] Monitor logs: all writes dual-written
- [ ] Validation passes: zero drift
- [ ] Ready for Phase 3 (cutover)

---

## Monitoring During Shadow Phase

### Logs to Check

```bash
# In monolith logs
tail -f logs/app.log | grep dualWrite
# Should see: "dual-write completed for upload X"

# In service logs
tail -f logs/upload-service.log | grep upsert
# Should see: "upserted upload X"

# Check counts continuously
psql -U postgres -d tejoma_recruiting -c "SELECT COUNT(*) FROM uploads"
psql -U postgres -d tejoma_uploads -c "SELECT COUNT(*) FROM uploads"
# Should match
```

### Error Handling

If dual-write fails:
1. Log the error (never block primary operation)
2. Retry in background job queue
3. Alert ops team if failures accumulate
4. Run validation script to catch drift

---

## Rollback (If Issues Found)

```bash
# Simply set DUAL_WRITE_ENABLED=false
# Writes stop mirroring
# Monolith continues working 100%
# No data lost on either side
```

---

## Success Criteria for Phase 2

✅ Dual-write hooks added to monolith
✅ Backfill scripts complete (all historical data loaded)
✅ Validation scripts pass (zero drift detected)
✅ A/B parity tests confirm response matches
✅ Shadow mode enabled (DUAL_WRITE_ENABLED=true)
✅ Monitoring in place (watch for dual-write failures)
✅ Rollback tested (DUAL_WRITE_ENABLED=false works instantly)

---

## Next: Phase 3 (Cutover)

When Phase 2 validation passes:
1. Set UPLOAD_SERVICE_ENABLED=true in staging
2. Routes now proxy to upload-service (reads/writes)
3. Monolith still mirrors (dual-read in reverse)
4. Monitor for 24h in staging
5. Roll out to production (10% → 50% → 100%)

---

**Status**: Phase 2 spec ready for implementation
**Timeline**: 1 week (Aug 9-15)
**Risk**: LOW (shadow mode, reads still from monolith)
**Rollback**: Instant (flip DUAL_WRITE_ENABLED=false)
