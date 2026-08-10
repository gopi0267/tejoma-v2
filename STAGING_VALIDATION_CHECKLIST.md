# Staging Validation Checklist

**Scope**: Phase 1 (Steps 1, 3, 5) + Phase 2 (Write Operations)  
**Environment**: Staging  
**Date Started**: 2026-08-07  
**Prepared By**: QA + Ops Teams  

---

## PRE-DEPLOYMENT VALIDATION

### Code Quality
- [ ] All unit tests passing (`npm test`)
- [ ] All integration tests passing (`npm test:integration`)
- [ ] No console.error/warn in new code (production logging only)
- [ ] All TypeScript types correct (no `any` except intentional)
- [ ] Linting passed (`npm run lint`)
- [ ] Security scan passed (OWASP top 10 check)
- [ ] Code review approved by senior engineer

### Infrastructure
- [ ] All 6 microservices deployed to staging
- [ ] All services healthy (health check responding)
- [ ] All databases ready (migrations applied)
- [ ] API Gateway routing configured
- [ ] Monolith proxy fallback ready
- [ ] Logging infrastructure ready (ELK/Splunk)
- [ ] Monitoring dashboards ready (Grafana)

### Data Integrity
- [ ] Dual-write client tested (monolith client)
- [ ] Fire-and-forget error handling verified
- [ ] Timeout handling tested (5-second max)
- [ ] No data loss possible (verified in code review)
- [ ] Rollback procedure documented

---

## PHASE 1 READ OPERATIONS VALIDATION

### Step 1: GET /api/jobs/:id (Job Detail with Ranking)

**Feature Flag**: `JOB_DETAIL_CUTOVER_ENABLED`

**Validation Tests**:
- [ ] Flag OFF: Request returns 404 (safe fallback)
- [ ] Flag ON: Request returns job + ranked candidates
- [ ] Candidates ranked by match_score (descending)
- [ ] All fields present (id, title, matched_candidates[])
- [ ] Monolith comparison: Ranking order identical
- [ ] Cross-service calls: Candidate-core + matching-scoring responsive
- [ ] Timeouts: If service slow, returns unsorted (graceful degradation)
- [ ] Error handling: 400 for invalid ID, 404 for not found, 500 for server errors

**Load Test**:
- [ ] 50 req/s for 1 hour: P99 latency < 500ms, error < 0.01%
- [ ] Memory stable (no leaks)
- [ ] Connection pool healthy

**A/B Parity**:
- [ ] 100 random job IDs: service response === monolith response
- [ ] No field differences
- [ ] Same candidate ordering

### Step 3: GET /api/candidates/:id/resume (Resume Detail)

**Feature Flag**: `CANDIDATE_RESUME_CUTOVER_ENABLED`

**Validation Tests**:
- [ ] Flag OFF: Request returns 404 (safe fallback)
- [ ] Flag ON: Request returns resume fields
- [ ] Fields returned: resume_text, resume_summary, file_path, embedding
- [ ] Monolith comparison: Identical fields and values
- [ ] Empty resume handling: Returns null fields (not errors)
- [ ] Error handling: 400 for invalid ID, 404 for not found

**Load Test**:
- [ ] 100 req/s for 1 hour: P99 latency < 100ms (pure local), error < 0.01%
- [ ] Memory stable
- [ ] No latency degradation

**A/B Parity**:
- [ ] 50 random candidate IDs: service === monolith
- [ ] Resume fields identical

### Step 5: GET /api/recruiter-matches (Matched Candidates)

**Feature Flag**: `RECRUITER_MATCHES_CUTOVER_ENABLED`

**Validation Tests**:
- [ ] Flag OFF: Proxies to monolith (existing behavior)
- [ ] Flag ON: Uses service implementation
- [ ] Cross-service calls working:
  - [ ] candidate-service responding (matches)
  - [ ] job-service responding (job titles)
  - [ ] candidate-core-service responding (names, skills)
  - [ ] Local notifications (read_at status)
- [ ] All fields present (id, job_title, candidate_name, etc.)
- [ ] Monolith comparison: Identical response format
- [ ] Timeout handling: Returns basic matches if job/candidate service slow
- [ ] Error handling: 400, 404, 500 responses correct

**Load Test**:
- [ ] 50 req/s for 1 hour: P99 latency < 1000ms (3 parallel calls), error < 0.01%
- [ ] Parallel fetching verified (job + candidate calls simultaneous)
- [ ] No connection leaks

**A/B Parity**:
- [ ] 20 company IDs with matches: service === monolith
- [ ] Job titles match
- [ ] Candidate names match
- [ ] Notification status matches

---

## PHASE 2 WRITE OPERATIONS VALIDATION

### Candidate-Core-Service

#### POST /api/candidates (Create)
- [ ] Valid payload: Creates candidate in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Response includes created ID
- [ ] CQRS view updated (if applicable)
- [ ] Invalid payload (missing name): Returns 400
- [ ] Duplicate email: Handled (depends on unique constraint)

#### DELETE /api/candidates/:id
- [ ] Valid ID: Soft deletes in local DB
- [ ] Monolith receives dual-delete within 5 seconds
- [ ] Invalid ID: Returns 404
- [ ] Query after delete: Returns 404 (candidate hidden)

### Job-Service

#### POST /api/jobs (Create)
- [ ] Valid payload: Creates job in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Response includes created ID + job details
- [ ] CQRS view updated (recruiter_review_view row inserted)
- [ ] Invalid payload: Returns 400
- [ ] Concurrent creates: No race conditions

#### PUT /api/jobs/:id (Update)
- [ ] Valid ID + payload: Updates job in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Only updated fields change (not entire record)
- [ ] CQRS view updated (recruiter_review_view refreshed)
- [ ] Invalid ID: Returns 404
- [ ] Partial update: Works (optional fields)

#### DELETE /api/jobs/:id
- [ ] Valid ID: Soft deletes in local DB
- [ ] Monolith receives dual-delete within 5 seconds
- [ ] CQRS view cleaned up
- [ ] Query after delete: Returns 404

### Matching-Decision-Service

#### POST /api/swipes (Record Swipe)
- [ ] Valid payload: Records swipe in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Orchestration working:
  - [ ] Candidate fetched from candidate-core-service
  - [ ] Job fetched from job-service
  - [ ] Score computed from matching-scoring-service
- [ ] Timeout handling: Returns swipe with score 0 if service slow
- [ ] CQRS view updated (recruiter_review_view row upserted)
- [ ] Notifications created for recruiter
- [ ] Invalid payload (missing job_id): Returns 400
- [ ] Not found (job/candidate): Returns 404
- [ ] Concurrent swipes: No race conditions

#### PATCH /api/recruiter-review/:id/decision
- [ ] Valid ID + decision: Updates swipe decision in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Score recomputed (fresh from matching-scoring-service)
- [ ] CQRS view updated with new score
- [ ] Invalid decision: Returns 400
- [ ] Invalid ID: Returns 404

#### POST /api/recruiter-review/:id/notes
- [ ] Valid ID + note: Creates note record in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] CQRS view updated (note text updated)
- [ ] Invalid ID: Returns 404

### Candidate-Service

#### PUT /api/candidate-profile/me (Update Profile)
- [ ] Valid payload: Updates candidate_accounts in local DB
- [ ] All fields optional (partial updates work)
- [ ] Validation works:
  - [ ] Name non-empty
  - [ ] Skills is array
  - [ ] Booleans must be true/false
- [ ] Completion percent recalculated
- [ ] No cross-service calls (local only)
- [ ] Invalid payload: Returns 400

#### POST /api/candidate-profile/experiences
- [ ] Valid payload: Creates experience record in local DB
- [ ] Links to candidate_accounts correctly
- [ ] All fields present in response
- [ ] Invalid payload: Returns 400

#### PUT /api/candidate-profile/experiences/:id
- [ ] Valid ID + payload: Updates experience record
- [ ] All fields optional (partial updates)
- [ ] Invalid ID: Returns 404
- [ ] Invalid payload: Returns 400

#### DELETE /api/candidate-profile/experiences/:id
- [ ] Valid ID: Deletes experience record
- [ ] Invalid ID: Returns 404

#### POST /api/candidate-profile/skills
- [ ] Valid payload: Updates skills array in candidate_accounts
- [ ] Completion percent recalculated
- [ ] Invalid payload: Returns 400

#### DELETE /api/candidate-profile/skills/:skillId
- [ ] Valid ID: Removes skill from array
- [ ] Completion percent recalculated

### Chat-Service

#### POST /api/chat (Interactive Chat)
- [ ] Valid message: Returns AI-generated reply
- [ ] Retrieves relevant chunks from knowledge base
- [ ] Sources included in response
- [ ] History trimmed to max turns
- [ ] Empty message: Returns 400
- [ ] AI API timeout: Returns 500 (not blocking)

### Upload-Service

#### POST /api/uploads (File Upload)
- [ ] Valid file: Uploads to storage + creates record in local DB
- [ ] Monolith receives dual-write within 5 seconds
- [ ] Dual-writes after storage confirmation
- [ ] Resume extraction queued (if resume file type)
- [ ] File size validation: Rejects > max size
- [ ] MIME type validation: Accepts allowed types
- [ ] No file: Returns 400
- [ ] Invalid candidate/recruiter: Returns 400
- [ ] Storage failure: Rolls back + returns 500

---

## DUAL-WRITE VALIDATION

### Consistency Checks
- [ ] All POST operations: Monolith has matching record within 5 seconds
- [ ] All PUT operations: Monolith has matching updates within 5 seconds
- [ ] All DELETE operations: Monolith has matching deletes within 5 seconds
- [ ] No orphaned records (every service write → monolith write)
- [ ] No missing writes (every monolith read shows new records)

### Failure Scenarios
- [ ] Monolith unavailable: Service write succeeds, dual-write fails gracefully
- [ ] Monolith slow (>5 seconds): Service returns success (async dual-write)
- [ ] Service unavailable: Monolith proxy takes traffic (fallback works)
- [ ] Network partition: Graceful degradation (no cascading failures)

---

## FEATURE FLAG VALIDATION

### Flag Control
- [ ] All 5 flags can be toggled (ON/OFF)
- [ ] Flag toggle takes effect within 1 minute (no restart needed)
- [ ] Flag toggle doesn't affect existing requests in flight
- [ ] Flag state visible in monitoring dashboard

### Flag Behavior
- [ ] OFF: All requests go to monolith (safe fallback)
- [ ] ON: All requests go to service (new implementation)
- [ ] Toggle OFF→ON→OFF: Works without errors
- [ ] Concurrent traffic during toggle: No errors

---

## ERROR HANDLING VALIDATION

### HTTP Status Codes
- [ ] 400: Invalid input (validated in multiple tests)
- [ ] 401: Unauthorized (if applicable)
- [ ] 404: Not found (tested for all read + write)
- [ ] 500: Server error (tested with intentional failures)
- [ ] 502: Upstream unavailable (monolith proxy errors)

### Error Messages
- [ ] Clear error messages (no stack traces exposed)
- [ ] Consistent error format
- [ ] No sensitive data in errors
- [ ] Logging: All errors logged with context

---

## PERFORMANCE BASELINE

### Latency Targets (P99)
- [ ] Pure local reads (resume): < 100ms ✓
- [ ] Local + 2-service orchestration (jobs): < 500ms ✓
- [ ] Local + 3-service orchestration (matches): < 1000ms ✓
- [ ] Local writes (profile): < 200ms ✓
- [ ] Complex writes (swipes): < 500ms ✓

### Throughput Targets
- [ ] 50 req/s sustained: Error rate < 0.01%, memory stable
- [ ] 100 req/s burst: Error rate < 0.05%, p95 latency < 2x baseline
- [ ] No connection leaks (connection pool stable)
- [ ] No memory leaks (memory usage flat across 1 hour)

### Resource Usage
- [ ] CPU: < 70% under load
- [ ] Memory: < 80% peak
- [ ] Disk: > 10GB free for logs
- [ ] Network: No packet loss

---

## SECURITY VALIDATION

### Data Protection
- [ ] No passwords in logs
- [ ] No API keys in responses
- [ ] No sensitive data in error messages
- [ ] HTTPS enforced (all staging requests HTTPS)
- [ ] Request signing verified (JWT valid)

### Cross-Service Communication
- [ ] Internal endpoints require no auth (network boundary enforced)
- [ ] Public endpoints require auth (JWT validation)
- [ ] CORS headers correct
- [ ] Rate limiting working

### Input Validation
- [ ] SQL injection not possible (parameterized queries)
- [ ] XSS not possible (no HTML generation)
- [ ] CSRF protection: SameSite cookies set
- [ ] File uploads: Extension validation, size limits

---

## FINAL SIGN-OFF

### Checklist Summary
- [ ] All 50+ tests passed
- [ ] All A/B parity verified
- [ ] Performance baselines met
- [ ] Error handling verified
- [ ] Security verified
- [ ] No data loss possible
- [ ] Rollback tested
- [ ] Team sign-offs collected

### Sign-Off Approvers
- [ ] QA Lead: _________________ Date: _______
- [ ] Ops Lead: ________________ Date: _______
- [ ] Tech Lead: _______________ Date: _______
- [ ] Product Lead: _____________ Date: _______

### Decision
- [ ] **APPROVED FOR PRODUCTION CANARY**
- [ ] **HOLD - Issues found** (document below)

**Issues Found** (if any):
```
[List any issues that need resolution before canary]
```

---

**Document Owner**: QA Lead  
**Last Updated**: 2026-08-07  
**Status**: READY FOR STAGING
