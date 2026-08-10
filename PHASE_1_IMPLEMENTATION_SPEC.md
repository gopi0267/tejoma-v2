# Phase 1 Implementation Specification
## Foundation: Identity, Upload, Resume, Notifications Services

**Duration**: 2-3 weeks  
**Team**: 3-4 senior engineers  
**Goal**: Complete auth migration + real-time notifications + file processing pipeline

---

## 1. Identity Service Completion

### Current State
- ✅ identity-service exists with full auth implementation
- ⚠️ Monolith routes (auth.routes.ts, candidate-auth.routes.ts, users.routes.ts) still have logic
- ⚠️ Traffic likely still hitting monolith auth endpoints

### Required Work

#### 1.1 Verify Identity-Service Complete
- [ ] Check all endpoints exist: /auth/signup/*, /auth/login/*, /auth/refresh, /auth/logout
- [ ] Check candidate-auth endpoints: /candidate-auth/signup/*, /candidate-auth/login/*
- [ ] Check user management: /users/*, /users/:id/*
- [ ] Verify database owns: users, refresh_tokens, password_history, otp_codes
- [ ] Verify JWT signing working (RS256 or HS256)

#### 1.2 Remove Monolith Auth Routes (After Validation)
**Files to delete after cutover:**
- `src/api/auth.routes.ts` (proxy to identity-service)
- `src/api/candidate-auth.routes.ts` (proxy to identity-service)
- `src/api/users.routes.ts` (proxy to identity-service)

**Files to keep (already ported):**
- `src/utils/tokens.ts` (JWT signing - verify identity-service has this)
- `src/utils/password.ts` (password validation - reused by identity-service)
- `src/utils/otp.ts` (OTP generation - reused by identity-service)
- `src/utils/email.js` (email sending - reused by multiple services)

#### 1.3 Route Consolidation in API Gateway
**nginx/conf.d/tejoma.conf** - verify auth routes point to identity-service:
```nginx
location ~ ^/api/auth/ {
    proxy_pass http://identity-service:4001;
}

location ~ ^/api/candidate-auth/ {
    proxy_pass http://identity-service:4001;
}

location ~ ^/api/users/ {
    proxy_pass http://identity-service:4001;
}
```

#### 1.4 Update docker-compose.yml
Ensure identity-service is running with full config:
- Database: tejoma_identity
- JWT_SECRET or RS256 keys configured
- All required env vars set
- Linked to api-gateway

### Production Checklist - Identity Service
- [ ] All auth routes respond with <500ms p99
- [ ] Login/logout flow tested end-to-end
- [ ] Token refresh working
- [ ] OTP flow working (email + SMS)
- [ ] Password reset working
- [ ] User management endpoints accessible to admins only
- [ ] Rate limiting on login/signup (identity-service has this?)
- [ ] Monitoring: auth success/failure rates, token validation time
- [ ] Structured logging: correlation IDs on all auth calls
- [ ] Rollback: If identity-service down, traffic falls back to monolith (check nginx fallback)

---

## 2. Upload Service (NEW)

### Database Schema
```sql
-- uploads service (tejoma_uploads)

CREATE TABLE uploads (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER,  -- NULL if recruiter upload
  recruiter_id INTEGER,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),  -- "resume", "cover_letter", "portfolio", etc.
  mime_type VARCHAR(100),
  file_size_bytes INTEGER,
  storage_key VARCHAR(255),  -- S3 key or blob storage path
  upload_status VARCHAR(50),  -- "pending", "processing", "completed", "failed"
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_type CHECK (file_type IN ('resume', 'cover_letter', 'portfolio', 'document'))
);

CREATE INDEX idx_uploads_candidate_id ON uploads(candidate_id);
CREATE INDEX idx_uploads_recruiter_id ON uploads(recruiter_id);
CREATE INDEX idx_uploads_company_id ON uploads(company_id);
```

### Service Architecture

```
upload-service/
├── src/
│   ├── config/
│   │   ├── env.ts          # S3_BUCKET, MAX_FILE_SIZE, etc.
│   │   └── storage.ts      # AWS S3 or Azure Blob config
│   ├── db.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── internal.routes.ts
│   │   └── upload.routes.ts  # POST /uploads (multipart/form-data)
│   ├── services/
│   │   ├── storageService.ts  # Upload to S3/blob
│   │   ├── resumeExtractorClient.ts  # Call resume-service async
│   │   └── dualWriteClient.ts  # Mirror to monolith
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── multipart.middleware.ts  # File size, type validation
│   │   └── corruption-check.middleware.ts  # Hash verification
│   ├── types.ts
│   ├── server.ts
│   └── utils/logger.ts
├── migrations/
│   ├── 001_initial.up.sql
│   └── 001_initial.down.sql
├── tests/
│   ├── upload.test.ts
│   └── integration.test.ts
├── Dockerfile
└── docker-compose.override.yml
```

### Key Features
1. **Multipart form upload** - candidate_id or recruiter_id, file, metadata
2. **Virus scanning** - integrate ClamAV or cloud AV before storing
3. **File type validation** - only allow PDF, DOCX, PPTX, etc.
4. **Size limits** - max 10MB per file
5. **Storage backend** - S3 or Azure Blob Storage (not filesystem)
6. **Async processing** - queue job to resume-service immediately
7. **Dual-write** - record upload metadata in monolith
8. **Error handling** - non-fatal upstream calls (resume extraction failure doesn't fail upload)

### Implementation Details

**POST /api/upload** (Public)
```typescript
// Request:
{
  file: File (multipart/form-data),
  candidate_id?: number,
  recruiter_id?: number,  // One of these required
  file_type: "resume" | "cover_letter" | "portfolio"
}

// Response:
{
  id: number,
  upload_id: string,
  status: "pending",
  storage_key: "s3://bucket/uploads/...",
  created_at: string
}

// Side effects:
1. Validate auth + company_id
2. Validate file (size, type, not corrupted)
3. Scan for viruses
4. Upload to S3/Blob
5. Create uploads table row
6. Queue resume extraction job (if file_type = "resume")
7. Dual-write upload metadata to monolith
8. Return immediately (don't wait for extraction)
```

**GET /api/upload/:id** (Public, get-only)
```typescript
// Return upload status + download link
```

### Dual-Write to Monolith
In `src/dualWrite.ts` (monolith):
```typescript
export function upsertUpload(row: {
  id: number;
  company_id: number;
  candidate_id?: number;
  recruiter_id?: number;
  file_name: string;
  file_type: string;
  storage_key: string;
  upload_status: string;
}): void {
  // Fire-and-forget call to upload-service to mirror upload metadata
}
```

### Feature Flag
```typescript
export const UPLOAD_SERVICE_ENABLED = process.env.UPLOAD_SERVICE_ENABLED === 'true';

// In monolith upload route:
if (UPLOAD_SERVICE_ENABLED) {
  // Call upload-service
} else {
  // Use monolith upload logic (S3 direct)
}
```

---

## 3. Resume Service (NEW)

### Database Schema
```sql
-- resume-service (tejoma_resume)

CREATE TABLE resumes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  upload_id INTEGER,  -- Foreign key to uploads service
  file_storage_key VARCHAR(255),
  raw_text TEXT,
  parsed_sections JSONB,  -- {education, experience, skills, projects, certifications}
  extracted_skills TEXT[],
  extracted_experience_years NUMERIC,
  detected_location VARCHAR(255),
  language_detected VARCHAR(10),  -- "en", "es", "fr", etc.
  parsing_status VARCHAR(50),  -- "pending", "processing", "completed", "failed"
  parser_error TEXT,
  last_updated_by VARCHAR(50),  -- "ocr", "regex", "llm"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_resumes_candidate_id ON resumes(candidate_id);
CREATE INDEX idx_resumes_company_id ON resumes(company_id);

-- Job queue table (part of resume-service)
CREATE TABLE resume_extraction_jobs (
  id SERIAL PRIMARY KEY,
  upload_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  status VARCHAR(50),  -- "pending", "processing", "completed", "failed"
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_status ON resume_extraction_jobs(status);
```

### Service Architecture

```
resume-service/
├── src/
│   ├── config/
│   │   ├── env.ts  # UPLOAD_SERVICE_URL, CANDIDATE_CORE_SERVICE_URL
│   │   └── queue.ts  # BullMQ config
│   ├── db.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── internal.routes.ts  # GET /resumes/:candidateId
│   │   └── upload-webhook.routes.ts  # POST /webhook/upload-completed
│   ├── processors/
│   │   ├── resumeExtractionProcessor.ts  # BullMQ job processor
│   │   ├── ocr.ts  # Tesseract OCR for scanned PDFs
│   │   ├── pdfParser.ts  # PDF text extraction
│   │   ├── docxParser.ts  # DOCX extraction
│   │   └── skillExtractor.ts  # Named entity recognition for skills
│   ├── services/
│   │   ├── uploadServiceClient.ts  # Get file from upload-service
│   │   ├── candidateCoreServiceClient.ts  # Mirror skills back
│   │   ├── dualWriteClient.ts  # Mirror to monolith resumes
│   │   └── eventPublisher.ts  # Publish resume:parsed event
│   ├── types.ts
│   ├── server.ts
│   └── utils/logger.ts
├── migrations/
│   ├── 001_initial.up.sql
│   └── 001_initial.down.sql
├── tests/
│   └── resumeExtraction.test.ts
├── Dockerfile
└── docker-compose.override.yml
```

### Job Queue (BullMQ)
Uses Redis queue:
```typescript
const resumeQueue = new Queue('resume-extraction', {
  connection: redisClient,
  // Retry on failure
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Process jobs
resumeQueue.process(10, async (job) => {
  const { uploadId, candidateId, companyId } = job.data;
  
  // 1. Get file from upload-service
  const file = await uploadServiceClient.getFile(uploadId);
  
  // 2. Extract text (PDF → DOCX → OCR)
  const rawText = await extractText(file);
  
  // 3. Parse structure (skills, experience, etc.)
  const parsed = await parseStructure(rawText);
  
  // 4. Save to resume-service DB
  await db.updateResume(candidateId, { parsed_sections, extracted_skills, ... });
  
  // 5. Dual-write to monolith
  dualWrite.upsertResume({ candidateId, ... });
  
  // 6. Emit event for candidate-service to mirror skills
  eventPublisher.publish('resume:parsed', { candidateId, skills: parsed.skills });
});
```

### Integration with Upload Service
When upload-service completes upload:
1. Create resume extraction job in queue
2. POST webhook to resume-service: `/webhook/upload-completed?uploadId=...`
3. Resume-service immediately queues job to BullMQ
4. Job processes asynchronously
5. On completion, emit event or direct call to candidate-service

### Dual-Write to Monolith
```typescript
// src/dualWrite.ts (monolith)
export function upsertResume(row: {
  candidate_id: number;
  raw_text: string;
  parsed_sections: object;
  extracted_skills: string[];
  ...
}): void {
  // Mirror parsed resume data to monolith
}
```

### Feature Flag
```typescript
export const RESUME_SERVICE_ENABLED = process.env.RESUME_SERVICE_ENABLED === 'true';
```

---

## 4. Notifications Service (NEW)

### Database Schema
```sql
-- notifications-service (tejoma_notifications)

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,  -- candidate_id or recruiter_id (user_id from identity-service)
  notification_type VARCHAR(50),
  title VARCHAR(255),
  message TEXT,
  data JSONB,  -- {candidateId, jobId, matchScore, etc.}
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read_at ON notifications(user_id, read_at);

CREATE TABLE notification_preferences (
  user_id INTEGER PRIMARY KEY,
  email_on_match BOOLEAN DEFAULT true,
  email_on_shortlist BOOLEAN DEFAULT true,
  sms_on_important BOOLEAN DEFAULT true,
  do_not_disturb_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Service Architecture

```
notifications-service/
├── src/
│   ├── config/
│   │   ├── env.ts  # REDIS_URL, SOCKET_IO_CORS, etc.
│   │   └── socketio.ts  # Socket.io config
│   ├── db.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── internal.routes.ts  # GET /notifications/:userId, etc.
│   │   └── preferences.routes.ts  # PATCH /preferences/:userId
│   ├── services/
│   │   ├── websocketManager.ts  # Socket.io connection management
│   │   ├── eventSubscriber.ts  # Redis pub/sub to events
│   │   ├── emailClient.ts  # Send emails (fire-and-forget)
│   │   └── smsClient.ts  # Send SMS (fire-and-forget)
│   ├── middleware/
│   │   ├── auth.middleware.ts  # JWT validation for Socket.io
│   │   └── rateLimit.middleware.ts
│   ├── types.ts
│   ├── server.ts
│   └── utils/logger.ts
├── migrations/
│   ├── 001_initial.up.sql
│   └── 001_initial.down.sql
├── tests/
│   ├── websocket.test.ts
│   └── integration.test.ts
├── Dockerfile
└── docker-compose.override.yml
```

### Architecture Pattern

```
Service A (matching-decision-service)
  └─ onSwipeCreated event
    └─ Redis pub/sub: "swipe:created"
      └─ notifications-service subscribes
        └─ Emits via Socket.io to connected clients
          └─ Client receives real-time update

Service B (candidate-service)
  └─ onMatchFound event
    └─ Redis pub/sub: "match:found"
      └─ notifications-service
        └─ Stores in DB + emits to client + sends email
```

### Socket.io Events

**Client connects:**
```typescript
socket.on('connect', (data) => {
  // data.token (JWT)
  // Verify token, get user_id
  // Store connection: user_id → socket.id
  // Load unread notifications from DB
  // Emit 'notifications:unread' to client
});

socket.on('notifications:mark-read', (notificationIds) => {
  // Update DB
  // Acknowledge to client
});

socket.on('disconnect', () => {
  // Remove connection mapping
});
```

**Server emits:**
```typescript
// Real-time event from upstream service
io.to(user_id).emit('notification', {
  id: 123,
  type: 'match:found',
  title: 'New Match!',
  message: 'You matched with Acme Corp for Senior Engineer',
  data: { candidateId, jobId, matchScore }
});

// Broadcast to all connected clients of a user
io.to(userId).emit('notification:batch', notifications);
```

### Event Publishing from Other Services

Each service that creates events:
```typescript
// In matching-decision-service/src/routes/matches.routes.ts
import { publishEvent } from '../services/eventPublisher.ts';

await publishEvent('swipe:created', {
  candidateId,
  jobId,
  action: 'accepted',
  matchScore,
  recruiter_id: req.user.id,
});

// Event schema:
interface DomainEvent {
  type: 'swipe:created' | 'match:found' | 'shortlist:added' | ...;
  timestamp: string;
  companyId: number;
  [key: string]: any;
}
```

### Dual-Write Pattern
```typescript
// notifications-service stores notification
// Also calls back to monolith if needed (fire-and-forget)
```

### Feature Flag
```typescript
export const NOTIFICATIONS_SERVICE_ENABLED = process.env.NOTIFICATIONS_SERVICE_ENABLED === 'true';

// In routes that create notifications:
if (NOTIFICATIONS_SERVICE_ENABLED) {
  await notificationsServiceClient.createNotification({...});
} else {
  await monolithClient.createNotification({...});
}
```

---

## Phase 1 Implementation Sequence

### Week 1: Infrastructure
- [ ] Create upload-service directory structure
- [ ] Create resume-service directory structure
- [ ] Create notifications-service directory structure
- [ ] Set up databases (3 new databases)
- [ ] Create migrations
- [ ] Create docker-compose entries
- [ ] Update nginx routing

### Week 2: Upload & Resume Services
- [ ] Implement upload-service (multipart handling, storage)
- [ ] Implement resume-service (PDF/DOCX parsing, BullMQ)
- [ ] Implement dual-write hooks in monolith
- [ ] Implement backfill scripts
- [ ] Implement validation scripts
- [ ] Tests (unit + integration)

### Week 3: Notifications Service
- [ ] Implement notifications-service (Socket.io, pub/sub)
- [ ] Implement event publishing from services
- [ ] Wire webhooks
- [ ] Email/SMS integration
- [ ] Tests
- [ ] Production verification
- [ ] Documentation

### Week 4 (Overlap): Cutover & Validation
- [ ] A/B parity testing (old vs. new)
- [ ] Load testing
- [ ] Shadow mode validation
- [ ] Feature flag rollout (staging → prod)
- [ ] Monitoring setup
- [ ] On-call runbook
- [ ] Rollback drill

---

## Feature Flags for Phase 1

```typescript
// .env
UPLOAD_SERVICE_ENABLED=false  # Toggle uploads to new service
RESUME_SERVICE_ENABLED=false  # Toggle resume extraction
NOTIFICATIONS_SERVICE_ENABLED=false  # Toggle real-time notifications
IDENTITY_SERVICE_ONLY_AUTH=false  # Route all auth to identity-service
```

---

## Rollback Procedures

**Upload Service Rollback**
1. Flip UPLOAD_SERVICE_ENABLED=false
2. Monolith handles uploads directly
3. No data loss (uploads table persists)

**Resume Service Rollback**
1. Flip RESUME_SERVICE_ENABLED=false
2. Stop resume-service BullMQ jobs
3. Monolith handles resume extraction
4. Data can be back-synced from resume-service

**Notifications Rollback**
1. Flip NOTIFICATIONS_SERVICE_ENABLED=false
2. Reconnect Socket.io to monolith
3. Resume monolith notification broadcasts
4. Unread notifications persist in DB

---

## Production Readiness Checklist (Phase 1)

- [ ] All services deploy independently
- [ ] No circular dependencies
- [ ] Dual-write hooks fire non-fatally
- [ ] Backfill scripts populate all data
- [ ] Validation scripts show zero drift
- [ ] Feature flags default to false (monolith)
- [ ] Monitoring: latency, error rates, queue depths
- [ ] Structured logging with correlation IDs
- [ ] Load tests: 1000 req/s for each service
- [ ] Security: no direct DB access, only APIs
- [ ] Authentication: all routes require JWT
- [ ] Rate limiting on auth + upload
- [ ] File scanning (virus detection)
- [ ] File size limits enforced
- [ ] Resume extraction timeout: 30 seconds
- [ ] Socket.io reconnection logic tested
- [ ] A/B parity: old monolith vs. new service responses
- [ ] Rollback tested: flag flip recovers service
- [ ] Documentation: architecture, runbook, troubleshooting
- [ ] On-call: incident response playbook

---

## Dependencies Matrix

```
identity-service
  ├── upload-service (depends on identity for auth)
  ├── resume-service (depends on upload-service webhook)
  └── notifications-service (depends on identity for user_id → socket mapping)

All services
  ├── Redis (pub/sub for events)
  ├── S3/Blob storage (file storage)
  └── SMTP/SMS provider (email/SMS)
```

---

## Next Steps

1. **This turn**: Implement identity-service verification + upload-service foundation
2. **Next**: Resume-service + BullMQ integration
3. **Then**: Notifications-service + Socket.io
4. **Finally**: Cutover, validation, production rollout

Ready to proceed with implementation?
