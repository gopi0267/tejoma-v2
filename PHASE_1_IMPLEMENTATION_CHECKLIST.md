# Phase 1 Implementation Checklist

Track progress through Phase 1 microservices migration with this checklist. Each service follows the same strangler-fig pattern: **backfill → dual-write → shadow → validate → cutover → rollback**.

---

## Upload Service

### ✅ Development Complete
- [x] Database migrations (001_initial.up.sql / .down.sql)
- [x] Express server setup (server.ts)
- [x] Database layer (db.ts) with CRUD operations
- [x] Configuration (config/env.ts)
- [x] Health check routes
- [x] Upload routes (POST /uploads, GET /uploads/:id)
- [x] Storage service (S3/mock)
- [x] Resume extractor client (fire-and-forget webhook)
- [x] Dual-write client (mirror to monolith)
- [x] Logging utility
- [x] Entry point (index.ts)
- [x] package.json
- [x] tsconfig.json
- [x] .env.local

### 🔧 Development/Testing (DO NOW)
- [ ] Run `npm install` in upload-service/
- [ ] Create database: `psql -U postgres -c "CREATE DATABASE tejoma_uploads"`
- [ ] Run migrations: `psql -U postgres -d tejoma_uploads < upload-service/migrations/001_initial.up.sql`
- [ ] Start service: `cd upload-service && npm run dev`
- [ ] Verify health: `curl http://localhost:4030/health` (should return 200)
- [ ] Test upload endpoint (see PHASE_1_STATUS.md for curl example)
- [ ] Verify database tables created: `psql -U postgres -d tejoma_uploads -c "\dt"`

### 📊 Shadow Phase (Dual-Write, No Cutover)
- [ ] Add monolith's `/internal/uploads/create` endpoint
- [ ] Add `upsertUpload` function to src/dualWrite.ts
- [ ] Set `DUAL_WRITE_ENABLED=true` in monolith
- [ ] Set feature flag to `UPLOAD_SERVICE_ENABLED=false` (reads still from monolith)
- [ ] Verify dual-writes working: check both monolith and upload-service databases
- [ ] Monitor error logs: should be empty or only warnings

### 📈 Backfill & Validation
- [ ] Create scripts/backfill-upload-service.ts
  - Read all uploads from monolith
  - Batch insert into upload-service
  - Report success/failure counts
- [ ] Create scripts/validate-upload-service-sync.ts
  - Compare row counts: monolith vs. upload-service
  - Deep-compare N random rows (all columns)
  - Report zero drift or specific mismatches
- [ ] Run backfill: `npm run backfill:uploads`
- [ ] Run validation: `npm run validate:uploads` (should show zero drift)

### 🧪 A/B Testing (Parity Check)
- [ ] Create scripts/test-upload-parity.ts
  - Call monolith: POST /api/uploads
  - Call upload-service: POST /api/uploads
  - Compare responses (should be identical)
  - Report pass/fail
- [ ] Test with 10 different resume files
- [ ] Confirm status codes and response shapes match

### 🚀 Cutover (Feature Flag → True)
- [ ] **Staging first**: Set `UPLOAD_SERVICE_ENABLED=true` in staging
- [ ] Run A/B parity tests in staging (see A/B Testing above)
- [ ] Monitor staging logs for 1h: zero errors
- [ ] Load test: `npm run load-test` (target: 1000 req/s, p99 <500ms)
- [ ] **Production**: Set `UPLOAD_SERVICE_ENABLED=true` in production
- [ ] Monitor production for 4h: watch error rates, latency, logs

### 🔙 Rollback (Instant Recovery)
- [ ] Set `UPLOAD_SERVICE_ENABLED=false` (reverts to monolith immediately)
- [ ] Verify requests now reach monolith in logs
- [ ] Confirm upload-service can stay down without impacting users
- [ ] Document incident (if any issues during cutover)

---

## Resume Service

### 📝 Development (Follow Same Pattern)
- [ ] Create migrations/001_initial.up.sql
  - resumes table: id, upload_id, company_id, candidate_id, extracted_text, skills[], extraction_timestamp, created_at, updated_at
  - resume_extraction_jobs table: id, upload_id, status, error_message, created_at, updated_at
  - Indexes: (upload_id), (candidate_id), (status, created_at DESC)
- [ ] Create src/config/env.ts (copy from upload-service template)
- [ ] Create src/db.ts (CRUD for resumes + jobs)
- [ ] Create src/server.ts (Express setup)
- [ ] Create src/index.ts (entry point)
- [ ] Create src/routes/health.routes.ts
- [ ] Create src/routes/webhook.routes.ts
  - POST /webhook/upload-completed: receive upload event, queue extraction
- [ ] Create src/services/pdfExtractor.ts (pdf-parse for text)
- [ ] Create src/services/docxExtractor.ts (docx parser for text)
- [ ] Create src/services/skillExtractor.ts (NER skill detection)
- [ ] Create src/services/jobQueueClient.ts (BullMQ integration with Redis)
- [ ] Create src/services/dualWriteClient.ts (mirror to monolith)
- [ ] Create package.json, tsconfig.json, .env.local
- [ ] Run migrations, start service, verify health

### 🔗 Integration (After Development)
- [ ] Add monolith's `/internal/resumes/create` endpoint
- [ ] Add `upsertResume` to src/dualWrite.ts
- [ ] Create backfill script: scripts/backfill-resume-service.ts
- [ ] Create validation script: scripts/validate-resume-service-sync.ts
- [ ] Run backfill → validate → verify zero drift
- [ ] Set feature flag: `RESUME_SERVICE_ENABLED=true` (staging first)
- [ ] Run A/B parity tests
- [ ] Cutover to production with monitoring

---

## Notifications Service

### 📬 Development (Socket.io Pattern)
- [ ] Create migrations/001_initial.up.sql
  - notifications table: id, company_id, recipient_user_id, notification_type, title, message, data (JSON), read_at, created_at
  - notification_preferences table: id, company_id, user_id, notification_type, enabled, created_at, updated_at
  - Indexes: (recipient_user_id, read_at DESC), (created_at DESC)
- [ ] Create src/config/env.ts
- [ ] Create src/db.ts (CRUD for notifications)
- [ ] Create src/server.ts (Express + Socket.io)
- [ ] Create src/index.ts
- [ ] Create src/routes/health.routes.ts
- [ ] Create src/socketServer.ts (Socket.io server with auth)
  - Connect: authenticate user, map socket to user_id
  - Events: notification, notification-read, notification-deleted
  - Broadcast to user whenever new notification arrives
- [ ] Create src/redisSubscriber.ts (pub/sub for domain events)
  - Subscribe to Redis channels: notifications:*, uploads:*, resumes:*
  - Forward events to connected sockets
- [ ] Create src/services/eventPublisher.ts (publish events to Redis)
- [ ] Create src/services/dualWriteClient.ts (mirror to monolith)
- [ ] Create package.json, tsconfig.json, .env.local
- [ ] Run migrations, start service, verify health

### 🔗 Integration (After Development)
- [ ] Add event publishing to all services:
  - upload-service: publish when upload completes
  - resume-service: publish when extraction completes
  - matching-decision-service: publish when swipe action taken
  - candidate-service: publish when profile updated
  - identity-service: publish when user data changes
- [ ] Frontend WebSocket integration:
  - Connect to notifications-service on page load
  - Listen for notification events
  - Display real-time notifications
  - Send notification-read events on user interaction
- [ ] Create backfill script: scripts/backfill-notifications-service.ts
- [ ] Create validation script: scripts/validate-notifications-service-sync.ts
- [ ] Set feature flag: `NOTIFICATIONS_SERVICE_ENABLED=true` (staging first)
- [ ] Test WebSocket connections and real-time delivery
- [ ] Cutover to production

---

## Monolith Integration (Parallel Track)

### Feature Flags
- [x] Add UPLOAD_SERVICE_ENABLED, RESUME_SERVICE_ENABLED, NOTIFICATIONS_SERVICE_ENABLED to src/config/env.ts
- [x] Add service URLs to src/config/env.ts
- [ ] Add routing logic to src/api/*routes.ts to check flags and route to services

### Dual-Write Hooks
- [ ] Add to src/dualWrite.ts:
  - `upsertUpload(row)` - mirror to upload-service
  - `upsertResume(row)` - mirror to resume-service
  - `upsertNotification(row)` - mirror to notifications-service
- [ ] Call from db.ts functions:
  - After `createUpload`: `dualWrite.upsertUpload(upload)`
  - After `createResume`: `dualWrite.upsertResume(resume)`
  - After `createNotification`: `dualWrite.upsertNotification(notification)`

### Internal Endpoints
- [ ] Add POST /internal/uploads/create (receive dual-writes)
- [ ] Add POST /internal/resumes/create (receive dual-writes)
- [ ] Add POST /internal/notifications/create (receive dual-writes)
- [ ] Store in temporary mirror tables for validation

### Route Proxying
- [ ] In src/api/upload.routes.ts, check UPLOAD_SERVICE_ENABLED flag
  - If true: proxy to UPLOAD_SERVICE_URL
  - If false: use monolith handler
- [ ] Same for resume and notifications routes

---

## Docker Compose Updates

- [ ] Add upload-service to docker-compose.yml
  - Mount migrations directory
  - Set environment variables (DB_NAME=tejoma_uploads, etc.)
  - Depends on: postgres
- [ ] Add resume-service to docker-compose.yml
  - Depends on: postgres, redis
- [ ] Add notifications-service to docker-compose.yml
  - Depends on: postgres, redis
- [ ] Verify all services start: `docker compose up`
- [ ] Test health endpoints for all services

---

## Testing & Validation

### Unit Tests (Per Service)
- [ ] Database layer: CRUD operations
- [ ] Service logic: file parsing, skill extraction, etc.
- [ ] Error handling: fire-and-forget never throws

### Integration Tests (Per Service)
- [ ] Full request flow: upload → process → response
- [ ] Cross-service calls: fire-and-forget with timeouts
- [ ] Database transactions: idempotent writes

### A/B Parity Tests (Before Cutover)
- [ ] Old monolith endpoint vs. new service endpoint
- [ ] Same input → same response (bit-for-bit for JSON)
- [ ] Timestamp precision: match to milliseconds
- [ ] Error scenarios: same error codes/messages

### Load Tests
- [ ] 1000 req/s for 10 minutes per service
- [ ] Monitor: error rate <0.1%, p99 latency <500ms
- [ ] Database connection pool: verify no exhaustion

### Rollback Drills
- [ ] Flip feature flag false: requests instantly route to monolith
- [ ] Verify old monolith handler works after cutover
- [ ] Document rollback procedure for on-call

---

## Production Readiness

### Monitoring & Observability
- [ ] Prometheus metrics exported from each service
- [ ] Grafana dashboards for error rates, latency, throughput
- [ ] Structured logging with correlation IDs
- [ ] Alert rules: error rate >1%, p99 >1s, service down

### Documentation
- [ ] README.md per service (setup, deployment, rollback)
- [ ] API contract documentation (request/response examples)
- [ ] Runbook for each service (common issues, fixes)
- [ ] On-call guide (who to contact, escalation path)

### Database Backups
- [ ] Automated backup of each service's database
- [ ] Test restore procedure
- [ ] Document RTO/RPO SLAs

### Security
- [ ] All endpoints require authentication
- [ ] Validate input (file types, sizes, etc.)
- [ ] No credentials in logs
- [ ] HTTPS in production (via nginx)

---

## Timeline

**Week 1** (NOW - Aug 6-10):
- [ ] Upload-service development & testing ✅ DONE
- [ ] Resume-service development (Wed-Thu)
- [ ] Notifications-service development (Fri)

**Week 2** (Aug 13-17):
- [ ] Monolith integration (dual-write hooks)
- [ ] Backfill scripts
- [ ] Validation scripts
- [ ] A/B parity tests

**Week 3** (Aug 20-24):
- [ ] Staging cutover & monitoring
- [ ] Production cutover (phased: 10% → 50% → 100%)
- [ ] Load testing
- [ ] Rollback drills

**Week 4** (Aug 27-31):
- [ ] Production stability monitoring
- [ ] Bug fixes if needed
- [ ] Cleanup: remove feature flags if all stable
- [ ] Post-mortem if any incidents

---

## Success Criteria

✅ Phase 1 is **production-ready** when:

1. All three services (upload, resume, notifications) are deployed and healthy
2. A/B parity tests show zero differences vs. monolith
3. Load tests pass: 1000 req/s, p99 <500ms per service
4. Monitoring dashboards show stable metrics post-cutover
5. Rollback tested: feature flag flip = instant recovery to monolith
6. Documentation complete and reviewed by team
7. On-call playbook created and tested
8. Zero production incidents in 48h after cutover

---

**Next Step**: Run `npm install && npm run dev` in upload-service to verify it starts locally.

