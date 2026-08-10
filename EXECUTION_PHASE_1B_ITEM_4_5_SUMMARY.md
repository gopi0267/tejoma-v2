# Execution: Items 4-5 - Analytics + CQRS (Complex Phase)

**Date**: 2026-08-07  
**Status**: DESIGN COMPLETE, HIGHEST COMPLEXITY  
**Scope**: Dual-write mirror + CQRS materialized view  
**Timeline**: 8 days (4 days Item 4, 4 days Item 5)  
**Dependencies**: Items 1-3 must be stable in staging first  

---

## ITEM 4: GET /api/candidate-analytics (Dual-Write Mirror)

### Current State
- **Endpoint**: GET /api/candidate-analytics
- **Location**: Proxies to monolith
- **Data**: 6-table join across 4 databases + complex scoring

### Problem
Three tables NOT mirrored anywhere today:
- `candidate_decisions` (recruiter career decisions)
- `candidate_application_status` (application state tracking)
- `mutual_matches` (matched pairs)

**Solution**: Build new dual-write mirror in candidate-service DB

---

## Step-by-Step Implementation (Item 4)

### Phase A: Schema & Migrations (Day 8)

#### 1. Create candidate-service/migrations/004_analytics_mirror.up.sql
```sql
-- New tables (mirror from monolith)
CREATE TABLE candidate_decisions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_account_id INTEGER NOT NULL,
  recruiter_id INTEGER NOT NULL,
  decision_type VARCHAR(50),
  decision_text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

CREATE TABLE candidate_application_status (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_account_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

CREATE TABLE mutual_matches (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_account_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  match_score NUMERIC(3,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

-- Indexes
CREATE INDEX ON candidate_decisions(company_id, candidate_account_id);
CREATE INDEX ON candidate_decisions(recruiter_id);
CREATE INDEX ON candidate_application_status(company_id, candidate_account_id);
CREATE INDEX ON candidate_application_status(job_id);
CREATE INDEX ON mutual_matches(company_id, candidate_account_id);
CREATE INDEX ON mutual_matches(job_id);
```

#### 2. Register migrations
- [ ] Add to migration runner
- [ ] Test in local environment
- [ ] Verify schema matches monolith exactly

### Phase B: Dual-Write Hooks (Day 8-9)

#### 3. Monolith: src/dualWrite.ts (ADD hooks)

**Pattern**: Already used by 25+ operations, just add 3 new ones

```typescript
// Fire-and-forget dual-write to candidate-service
async function createCandidateDecision(row: CandidateDecision): Promise<void> {
  if (!DUAL_WRITE_ENABLED) return;
  
  try {
    await candidateServiceClient.post('/internal/candidate-decisions', row);
  } catch (err) {
    logger.warn({ err: err.message }, 'Dual-write candidate decision failed');
  }
}

async function updateCandidateDecision(id: number, fields: Record<string, unknown>): Promise<void> {
  if (!DUAL_WRITE_ENABLED) return;
  
  try {
    await candidateServiceClient.patch(`/internal/candidate-decisions/${id}`, fields);
  } catch (err) {
    logger.warn({ err: err.message }, 'Dual-write update decision failed');
  }
}

// Similar for application_status and mutual_matches
```

#### 4. Monolith: Hook into write paths

In each endpoint that creates/updates these 3 tables, call the dual-write function:
- POST /api/candidate-decisions → `await dualWrite.createCandidateDecision(row)`
- PATCH /api/candidate-decisions/:id → `await dualWrite.updateCandidateDecision(id, fields)`
- Similar for application_status and mutual_matches

**Key**: These are all-or-nothing - if monolith creates it, dual-write happens (async, never blocks)

#### 5. candidate-service: src/routes/internal.routes.ts (ADD)

```typescript
router.post('/candidate-decisions', async (req, res) => {
  const { id, company_id, candidate_account_id, recruiter_id, decision_type, decision_text } = req.body;
  
  try {
    await db.query(
      `INSERT INTO candidate_decisions (id, company_id, candidate_account_id, recruiter_id, decision_type, decision_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET decision_text = EXCLUDED.decision_text, updated_at = NOW()`,
      [id, company_id, candidate_account_id, recruiter_id, decision_type, decision_text]
    );
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: 'Dual-write failed' });
  }
});

// Similar PATCH, DELETE endpoints
```

### Phase C: Backfill Script (Day 9)

#### 6. scripts/backfill-candidate-service-analytics.ts

```typescript
// Connect to monolith DB
const monolithPool = new Pool({ ... monolith config ... });

// Fetch all data from monolith
const decisions = await monolithPool.query('SELECT * FROM candidate_decisions');
const applications = await monolithPool.query('SELECT * FROM candidate_application_status');
const matches = await monolithPool.query('SELECT * FROM mutual_matches');

// Batch insert into candidate-service DB
const batchSize = 1000;
for (let i = 0; i < decisions.rows.length; i += batchSize) {
  const batch = decisions.rows.slice(i, i + batchSize);
  await servicePool.query(
    `INSERT INTO candidate_decisions (...) VALUES (...)
     ON CONFLICT (id) DO UPDATE SET ...`,
    batch
  );
}

// Similar for applications and matches
console.log('Backfill complete');
```

**Run**: `npm run backfill:candidate-service-analytics`

### Phase D: Validation Script (Day 9)

#### 7. scripts/validate-candidate-service-analytics-sync.ts

```typescript
// Count validation
const monoCount = await monolithPool.query('SELECT COUNT(*) FROM candidate_decisions');
const serviceCount = await servicePool.query('SELECT COUNT(*) FROM candidate_decisions');

if (monoCount.rows[0].count !== serviceCount.rows[0].count) {
  throw new Error(`Count mismatch: monolith=${monoCount} vs service=${serviceCount}`);
}

// Sample validation (100 random rows)
const samples = await monolithPool.query('SELECT * FROM candidate_decisions ORDER BY RANDOM() LIMIT 100');
for (const row of samples.rows) {
  const serviceRow = await servicePool.query('SELECT * FROM candidate_decisions WHERE id = $1', [row.id]);
  if (!deepEqual(row, serviceRow.rows[0])) {
    throw new Error(`Mismatch for row ${row.id}`);
  }
}

console.log('Validation passed');
```

**Run**: `npm run validate:candidate-service-analytics-sync`

### Phase E: Service Clients (Day 9)

#### 8. candidate-service: Add clients for cross-service reads

```typescript
// src/services/candidateCoreServiceClient.ts
export async function getCandidatesByAccountIds(accountIds: number[]): Promise<Candidate[]> {
  const response = await fetch(
    `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/by-account-id?accountIds=${accountIds.join(',')}`,
    { method: 'GET' }
  );
  return response.ok ? (await response.json()).candidates : [];
}

// src/services/matchingDecisionServiceClient.ts
export async function getLatestSwipesByCandidateIds(candidateIds: number[]): Promise<Swipe[]> {
  const response = await fetch(
    `${MATCHING_DECISION_SERVICE_URL}/internal/swipes/latest-by-candidate-ids?candidateIds=${candidateIds.join(',')}`,
    { method: 'GET' }
  );
  return response.ok ? (await response.json()).swipes : [];
}

// src/services/jobServiceClient.ts (reuse existing)
export async function getJobsByIds(jobIds: number[]): Promise<Job[]> {
  // Already exists
}
```

### Phase F: Handler Implementation (Day 10)

#### 9. candidate-service: GET /api/candidate-analytics handler

```typescript
router.get('/api/candidate-analytics', requireAuth, async (req, res) => {
  const companyId = req.user!.company_id;
  
  try {
    // Get all candidate account IDs for company
    const candidates = await db.getCandidateAccounts(companyId);
    const accountIds = candidates.map(c => c.id);
    
    // Parallel fetch from all services
    const [decisions, applications, matches, swipes, jobs] = await Promise.all([
      db.getCandidateDecisions(accountIds), // Local
      db.getCandidateApplicationStatus(accountIds), // Local
      db.getMutualMatches(accountIds), // Local
      getLatestSwipesByCandidateIds(accountIds.map(id => id)), // Cross-service
      getJobsByIds([...new Set(matches.map(m => m.job_id))]), // Cross-service
    ]);
    
    // Compute analytics (pure code from monolith)
    const analytics = computeCandidateAnalytics({
      candidates,
      decisions,
      applications,
      matches,
      swipes,
      jobs,
    });
    
    res.json(analytics);
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to compute analytics');
    res.status(502).json({ error: 'Analytics unavailable' });
  }
});
```

### Phase G: Feature Flag + Tests (Day 10-11)

#### 10. Feature flag
- [ ] `CANDIDATE_ANALYTICS_CUTOVER_ENABLED` in env.ts

#### 11. Tests
- [ ] Unit tests (mock all sources)
- [ ] Integration tests (real mirror sync)
- [ ] A/B parity (5 companies, full analytics)

### Phase H: Staging Sign-Off (Day 11)

- [ ] Dual-write running (new tables syncing)
- [ ] Backfill script tested
- [ ] Validation script passing
- [ ] A/B parity 100%
- [ ] Ready for production

---

## ITEM 5: GET /api/recruiter-review (list) - CQRS Materialized View

### Current State
- **Endpoint**: GET /api/recruiter-review (list with filters/pagination)
- **Location**: Proxies to monolith
- **Problem**: Single 5-table join across 4 databases
  - swipes, recruiter_notes (matching-decision-service)
  - candidates (candidate-core-service)
  - jobs (job-service)
  - users (identity-service)

### Solution: CQRS Materialized View
**One denormalized table** with all fields needed for the list response, upserted in place

---

## Step-by-Step Implementation (Item 5)

### Phase A: CQRS View Schema (Day 12)

#### 1. matching-decision-service/migrations/005_recruiter_review_view.up.sql

```sql
CREATE TABLE recruiter_review_view (
  -- Keys
  id BIGSERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  
  -- Candidate fields
  candidate_name VARCHAR(255),
  candidate_email VARCHAR(255),
  candidate_phone VARCHAR(20),
  candidate_skills TEXT[],
  candidate_company VARCHAR(255),
  candidate_location VARCHAR(255),
  candidate_years_experience NUMERIC,
  
  -- Job fields
  job_title VARCHAR(255),
  job_location VARCHAR(255),
  job_required_skills TEXT[],
  
  -- Recruiter fields
  recruiter_id INTEGER,
  recruiter_name VARCHAR(255),
  
  -- Swipe fields
  swipe_id BIGINT,
  action NUMERIC(2,1),
  match_score NUMERIC(3,2),
  decision_date TIMESTAMP,
  
  -- Note fields
  latest_note_text TEXT,
  latest_note_at TIMESTAMP,
  
  -- Housekeeping
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,
  
  -- Unique constraint: one row per (candidate, job)
  UNIQUE(candidate_id, job_id)
);

-- Indexes for all query patterns
CREATE INDEX ON recruiter_review_view(company_id, created_at DESC);
CREATE INDEX ON recruiter_review_view(company_id, recruiter_id, created_at DESC);
CREATE INDEX ON recruiter_review_view(company_id, job_id);
CREATE INDEX ON recruiter_review_view(company_id, action);

-- GIN index for full-text search (candidate_skills + names)
CREATE INDEX ON recruiter_review_view USING GIN (candidate_skills);
```

#### 2. Register migration
- [ ] Run migration in staging
- [ ] Verify indexes created

### Phase B: Backfill Script (Day 12)

#### 3. scripts/backfill-matching-decision-recruiter-review-view.ts

```typescript
// Connect to all 4 source databases
const jobServiceDb = new Pool({ ... });
const candidateCoreDb = new Pool({ ... });
const candidateServiceDb = new Pool({ ... });
const identityDb = new Pool({ ... });

// Step 1: Get all unique (candidate_id, job_id) pairs with latest swipe
const latestSwipes = await matchingDecisionDb.query(`
  SELECT DISTINCT ON (candidate_id, job_id)
    candidate_id, job_id, company_id, id, action, match_score, created_at, recruiter_id
  FROM swipes
  WHERE deleted_at IS NULL
  ORDER BY candidate_id, job_id, created_at DESC
`);

// Step 2: For each swipe, hydrate candidate + job + recruiter + note
const rows = [];
for (const swipe of latestSwipes.rows) {
  const candidate = await candidateCoreDb.query(
    'SELECT * FROM candidates WHERE id = $1',
    [swipe.candidate_id]
  );
  const job = await jobServiceDb.query(
    'SELECT * FROM jobs WHERE id = $1',
    [swipe.job_id]
  );
  const recruiter = await identityDb.query(
    'SELECT * FROM users WHERE id = $1',
    [swipe.recruiter_id]
  );
  const note = await matchingDecisionDb.query(
    'SELECT * FROM recruiter_notes WHERE candidate_id = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 1',
    [swipe.candidate_id, swipe.job_id]
  );
  
  rows.push({
    candidate_id: swipe.candidate_id,
    job_id: swipe.job_id,
    company_id: swipe.company_id,
    candidate_name: `${candidate.first_name} ${candidate.last_name}`,
    // ... all other fields
  });
}

// Step 3: Batch upsert into view
const batchSize = 1000;
for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);
  await matchingDecisionDb.query(
    `INSERT INTO recruiter_review_view (...) VALUES (...)
     ON CONFLICT (candidate_id, job_id) DO UPDATE SET ...`,
    batch
  );
}

console.log(`Backfill complete: ${rows.length} rows`);
```

### Phase C: Refresh Hooks (Day 12-13)

#### 4. matching-decision-service: Local hooks (in-process)

In `POST /swipes`, `PATCH /:id/decision`, `POST /:id/notes`:

```typescript
// After writing to swipes table, upsert view row
await db.upsertRecruiterReviewViewRow({
  candidate_id: req.body.candidate_id,
  job_id: req.body.job_id,
  company_id: req.user.company_id,
  // ... other fields already fetched
});
```

**Pattern**: Uses data already in scope (candidate, job, recruiter hydrated by orchestration)

#### 5. Cross-Service Refresh Hooks

##### candidate-core-service: Add outbound call

In `POST /candidates`, `PUT /candidates/:id`, `DELETE /candidates/:id`:

```typescript
// Fire-and-forget refresh hook (never blocks)
refreshRecruiterReviewViewForCandidate(req.user.company_id, candidateId);
```

**Implementation** (candidate-core-service/src/services/matchingDecisionServiceClient.ts):

```typescript
export async function refreshRecruiterReviewViewForCandidate(
  companyId: number,
  candidateId: number
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/recruiter-review-view/refresh-candidate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, candidateId }),
        signal: controller.signal,
      }
    );
    
    clearTimeout(timeoutId);
  } catch (err) {
    logger.warn({ err: err.message }, 'Refresh hook failed (non-fatal)');
  }
}
```

##### job-service: Similar pattern

In POST/PUT/DELETE /jobs, call:
```typescript
refreshRecruiterReviewViewForJob(req.user.company_id, jobId);
```

##### identity-service: Similar pattern

In PUT /users (name change), call:
```typescript
refreshRecruiterReviewViewForRecruiter(recruiterId);
```

#### 6. matching-decision-service: Receive refresh hooks

In `src/routes/internal.routes.ts`:

```typescript
router.post('/recruiter-review-view/refresh-candidate', async (req, res) => {
  const { companyId, candidateId } = req.body;
  
  // Find all swipes for this candidate and refresh them
  const swipes = await db.query(
    'SELECT DISTINCT ON (candidate_id, job_id) * FROM swipes WHERE candidate_id = $1 ORDER BY candidate_id, job_id, created_at DESC',
    [candidateId]
  );
  
  // Hydrate + upsert for each swipe (async, non-fatal)
  setImmediate(async () => {
    for (const swipe of swipes.rows) {
      try {
        const candidate = await getCandidatesByIds([candidateId]);
        await db.upsertRecruiterReviewViewRow({ ... });
      } catch (err) {
        logger.warn({ err: err.message }, 'Refresh failed');
      }
    }
  });
  
  res.json({ status: 'refresh_queued' });
});

// Similar for refresh-job, refresh-recruiter
```

**Key**: Responds immediately (queued), actual refresh happens async

### Phase D: GET Handler (Day 13)

#### 7. matching-decision-service: GET /api/recruiter-review (list)

```typescript
router.get('/recruiter-review', requireAuth, async (req, res) => {
  const companyId = req.user!.company_id;
  const { job_id, recruiter_id, action, search, page = 1, limit = 50 } = req.query;
  
  try {
    let query = 'SELECT * FROM recruiter_review_view WHERE company_id = $1 AND deleted_at IS NULL';
    const params = [companyId];
    let paramIndex = 2;
    
    // Optional filters
    if (job_id) {
      query += ` AND job_id = $${paramIndex++}`;
      params.push(Number(job_id));
    }
    if (recruiter_id) {
      query += ` AND recruiter_id = $${paramIndex++}`;
      params.push(Number(recruiter_id));
    }
    if (action !== undefined) {
      query += ` AND action = $${paramIndex++}`;
      params.push(Number(action));
    }
    if (search) {
      query += ` AND (candidate_skills @> ARRAY[$${paramIndex}] OR candidate_name ILIKE $${paramIndex + 1})`;
      params.push(search);
      params.push(`%${search}%`);
      paramIndex += 2;
    }
    
    // Pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const offset = ((Number(page) || 1) - 1) * (Number(limit) || 50);
    params.push(Number(limit) || 50);
    params.push(offset);
    
    const result = await db.query(query, params);
    const total = await db.query(
      `SELECT COUNT(*) FROM recruiter_review_view WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    
    res.json({
      data: result.rows,
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
      },
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to list recruiter reviews');
    res.status(502).json({ error: 'Recruiter review list unavailable' });
  }
});
```

### Phase E: Feature Flag + Tests (Day 13-14)

#### 8. Feature flag
- [ ] `RECRUITER_REVIEW_LIST_CUTOVER_ENABLED` in matching-decision-service

#### 9. Tests
- [ ] Unit tests (mock view queries)
- [ ] Integration tests (real view with data)
- [ ] Refresh hook tests (verify async refresh works)
- [ ] A/B parity (10 searches, deep-equal results)
- [ ] Performance tests (EXPLAIN ANALYZE on filters)

### Phase F: Staging Sign-Off (Day 14)

- [ ] View created + backfilled
- [ ] Refresh hooks working (all 3 services)
- [ ] GET handler returning correct results
- [ ] A/B parity 100%
- [ ] Indexes used (EXPLAIN ANALYZE)
- [ ] Ready for production

---

## Monitoring (Items 4-5)

### Dual-Write Metrics (Item 4)
```
candidate_service_dual_write_total{table,status}
candidate_service_dual_write_duration_seconds{table}
```

Alert: `dual_write_lag_seconds > 10`

### CQRS Metrics (Item 5)
```
recruiter_review_view_refresh_total{source,status}
recruiter_review_view_sync_drift{table}
```

Alert: `recruiter_review_view_sync_drift > 0` (data mismatch)

---

## Rollback (Items 4-5)

### Item 4 Rollback
```bash
# Flip feature flag
CANDIDATE_ANALYTICS_CUTOVER_ENABLED=false

# Restart service
kubectl rollout restart deployment/candidate-service
```

### Item 5 Rollback
```bash
# Flip feature flag
RECRUITER_REVIEW_LIST_CUTOVER_ENABLED=false

# Restart service
kubectl rollout restart deployment/matching-decision-service

# Note: View still syncing (can restart sync hooks anytime)
```

---

## Time Summary

| Phase | Hours | Days |
|-------|-------|------|
| Item 4 (Analytics) | 10 | 4 |
| Item 5 (CQRS) | 14 | 4 |
| **Total** | **24 hours** | **8 days** |

---

**Prepared by**: Migration Team  
**Status**: DESIGN COMPLETE  
**Estimated Start**: Aug 11 (after Items 1-3 sign-off)  
**Expected Completion**: Aug 19  
**Confidence**: MEDIUM-HIGH (Item 5 is complex, but well-designed)  
