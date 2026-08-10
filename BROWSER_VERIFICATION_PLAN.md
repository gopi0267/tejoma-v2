# Browser Verification Plan — Phases 1-9

**Date**: August 10, 2026  
**Status**: READY FOR BROWSER TESTING  
**Configuration**: DUAL_WRITE_ENABLED=false, MONOLITH_FALLBACK_ENABLED=false

---

## Available Test Accounts (from test fixtures)

### Recruiter Account
- **Email**: batch4-test-recruiter@example.test
- **Type**: Recruiter (staff)
- **Access**: Full recruiter functionality
- **Status**: Use if available in staging database

### Candidate Account
- **Email**: batch5-test-candidate@example.test  
- **Type**: Candidate (self-service)
- **Access**: Candidate portal functionality
- **Status**: Use if available in staging database

---

## Critical Browser Paths to Test

### Phase 1: Authentication Flows

**Path 1A: Recruiter Login**
```
Browser: GET https://localhost/
→ nginx (HTTPS)
→ API Gateway (reverse proxy)
→ Monolith SPA (static HTML)

Browser action: Enter email/password
→ POST /api/auth/login
→ identity-service (port 4017)
→ tejoma_identity DB
→ Return JWT token
```

**Path 1B: Candidate Login**
```
Browser: GET https://localhost/
→ Choose "Candidate Login"
→ POST /api/candidate-auth/login
→ identity-service (port 4017)
→ tejoma_identity DB (candidate_accounts table)
→ Return JWT token
```

### Phase 2: Candidate Profile Management

**Path 2A: View/Update Candidate Profile**
```
POST /api/candidate-profile → candidate-service (tejoma_candidate DB)
GET /api/candidate-profile → candidate-service (tejoma_candidate DB)
PUT /api/candidate-profile → candidate-service (tejoma_candidate DB)
```

**Path 2B: Resume Upload**
```
POST /api/candidate-resume/file → resume-service (tejoma_resume DB)
Multipart file upload
Returns: resume_file_path, resume_original_filename
```

**Path 2C: Resume Parsing**
```
POST /api/candidate-resume/parse → resume-service (tejoma_resume DB)
Accepts: PDF, DOCX, TXT
Returns: Parsed candidate data (name, skills, experience)
```

### Phase 3: Jobs & Matching

**Path 3A: Jobs List**
```
GET /api/jobs → job-service (tejoma_job DB)
Returns: List of jobs
```

**Path 3B: Job Details**
```
GET /api/jobs/:id → job-service (tejoma_job DB)
Returns: Full job details, requirements, salary range
```

**Path 3C: Matching**
```
POST /api/matches/score → matching-decision-service (tejoma_matching_decision DB)
GET /api/matches/queue/:jobId → matching-decision-service
Returns: Candidate-job match scores
```

### Phase 4: Recruiter Decision Making

**Path 4A: Recruiter Review**
```
GET /api/recruiter-review → matching-decision-service (tejoma_matching_decision DB)
POST /api/recruiter-review → matching-decision-service
```

**Path 4B: Accept/Reject/Save**
```
POST /api/recruiter-review/:id/accept → matching-decision-service
POST /api/recruiter-review/:id/reject → matching-decision-service
POST /api/recruiter-review/:id/save → matching-decision-service
```

**Path 4C: Recruiter Notes**
```
POST /api/recruiter-notes → matching-decision-service (tejoma_matching_decision DB)
Returns: Note stored in recruiter_notes table
```

### Phase 5: Analytics & Notifications

**Path 5A: Analytics Dashboard**
```
GET /api/analytics/dashboard → analytics-service (tejoma_analytics DB)
Returns: Dashboard metrics, swipe counts, match rates
```

**Path 5B: Notifications**
```
GET /api/recruiter-notifications → recruiting-service (tejoma_recruiting_service DB)
GET /api/candidate-notifications → candidate-service (tejoma_candidate DB)
```

### Phase 6: Chat (where implemented)

**Path 6A: Chat Functionality**
```
POST /api/chat → chat-service (tejoma_chat DB)
GET /api/chat/history → chat-service
Uses Redis for real-time messaging
```

---

## API-Level Verification (Can be Done Without Browser)

### Test 1: Authentication Path
```bash
# Test recruiter login (if account exists)
curl -X POST https://localhost/api/auth/login \
  -d '{"identifier":"batch4-test-recruiter@example.test","password":"..."}' \
  -w "Status: %{http_code}" 2>/dev/null

# Expected: 200 OK with JWT token
# OR: 401 Unauthorized (account doesn't exist/wrong password)
```

### Test 2: Authenticated Endpoint Access
```bash
# Using JWT token from login
curl -X GET https://localhost/api/candidate-profile \
  -H "Authorization: Bearer <JWT>" \
  -w "Status: %{http_code}" 2>/dev/null

# Expected: 200 OK with profile data (microservice response)
# NOT: 502 (monolith error) or 404 (fallback)
```

### Test 3: Write Operations
```bash
# Test candidate profile update
curl -X PUT https://localhost/api/candidate-profile \
  -H "Authorization: Bearer <JWT>" \
  -d '{"name":"Updated Name"}' \
  -w "Status: %{http_code}" 2>/dev/null

# Expected: 200 OK
# Verify: Database contains update, no monolith write
```

---

## Real Browser Testing Checklist

**Required**: Actual browser access to test these flows

- [ ] Navigate to https://localhost (HTTPS works, green padlock)
- [ ] Login with test account (receives JWT)
- [ ] View profile page
- [ ] Update profile fields
- [ ] Upload resume (test file)
- [ ] Parse resume (extracts data)
- [ ] View jobs list
- [ ] Click job details
- [ ] Perform matching
- [ ] Access recruiter review
- [ ] Make accept/reject decision
- [ ] Add recruiter notes
- [ ] View analytics dashboard
- [ ] Check notifications
- [ ] Use chat if available
- [ ] Logout
- [ ] Login again (session works)
- [ ] Refresh page (session persists)
- [ ] Open browser Network tab and verify:
  - No requests to monolith (http://localhost:3001)
  - No requests to monolith internal URLs
  - All requests to microservices via API Gateway
  - Responses come from correct services

---

## Monitoring During Browser Testing

**Server Logs to Watch**:
```bash
# Monitor API Gateway logs (should see microservice proxying, not monolith)
docker logs tejoma-api-gateway-1 | grep -E "upstream|monolith|502"

# Monitor microservice logs (should see requests)
docker logs tejoma-candidate-service-1 | grep -E "POST|GET|PUT"
docker logs tejoma-job-service-1 | grep -E "POST|GET|PUT"

# Monitor for dual-write activity (should be zero)
docker logs tejoma-app-1 | grep -i "dual.write\|mirror"
```

---

## Evidence to Collect

### Authentication
- [ ] Login successful (HTTP 200, JWT returned)
- [ ] JWT contains correct user_id, company_id, role
- [ ] Refresh token works
- [ ] Logout clears session

### RBAC/Tenant Isolation
- [ ] Recruiter cannot access other company's data
- [ ] Candidate cannot access recruiter features
- [ ] Company_id properly scoped in all queries

### Write Verification
- [ ] Profile update reflected in service database
- [ ] Resume stored in resume-service database
- [ ] Matcher decision stored in matching-decision-service database
- [ ] Recruiter notes in matching-decision-service database
- [ ] No writes to monolith database

### Microservice-Only Verification
- [ ] All requests routed through gateway
- [ ] No direct monolith requests
- [ ] No dual-write activity observed
- [ ] Monolith fallback NOT used
- [ ] Unmatched routes return 404 "fallback disabled"

---

## Phase 1-9 Test Execution

### Phase 1: Real Browser Test
**Status**: Requires manual browser access  
**Instructions**: Follow the checklist above in Chrome dev tools Network tab

### Phase 2: Request Path Verification
**Status**: Can be verified via API testing + logs

### Phase 3: Real Write Verification
**Status**: Can be verified via API testing + database checks

### Phase 4: Monolith Traffic Proof
**Status**: Can be verified via log inspection (grep for monolith calls)

### Phase 5: Authentication/Security
**Status**: Can be tested via API endpoints

### Phase 6: Extended Monitoring
**Status**: Requires continuous monitoring during browser use

### Phase 7: Regression Testing
**Status**: Ready (use existing test suite)

### Phase 8: Rollback Verification
**Status**: Already verified in Phase 5-10 of microservice-only test

### Phase 9: Canary Pre-Flight
**Status**: Ready (all prerequisites met)

---

## Configuration for Browser Testing

**HTTPS**: ✅ Certificate installed in Windows trust store  
**Gateway**: ✅ Routing microservices  
**Dual-Write**: ❌ OFF (DUAL_WRITE_ENABLED=false)  
**Fallback**: ❌ OFF (MONOLITH_FALLBACK_ENABLED=false)  
**Monolith**: ✅ Running (for emergency rollback only)  
**Services**: ✅ 31 containers healthy  
**Tests**: ✅ 1,082 passing  

**Ready for**: Real browser authentication testing with test accounts

---

## Next Steps

1. **Obtain test account credentials** (or register new test accounts)
2. **Open Chrome and navigate to https://localhost**
3. **Open DevTools (F12) → Network tab**
4. **Perform login and follow critical paths**
5. **Verify all requests go through microservices (check Network URLs)**
6. **Monitor server logs for any monolith traffic**
7. **Record results in evidence table**

---

**Note**: This plan documents what should be tested. Actual browser execution requires manual user interaction with a graphical browser and dev tools inspection.

