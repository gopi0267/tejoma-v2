# TEJOMA PRODUCTION DEPLOYMENT GUIDE
## Complete Preparation Checklist & Critical Blockers

**Date**: 2026-08-11  
**Status**: NOT YET PRODUCTION READY - Remediation Required  
**Target Readiness**: After completing all items in Section 1

---

## SECTION 1: CRITICAL BLOCKERS (Must Fix Before Deployment)

### ❌ BLOCKER 1: PostgreSQL Infrastructure Missing

**Issue**: PostgreSQL is not running on the host. All database operations will fail.

**Impact**: 
- Services cannot access their databases
- Health checks report false "healthy" status
- No business logic can execute

**Resolution**:
```bash
# 1. Ensure PostgreSQL 14+ is installed on the host
# For Ubuntu/Debian:
sudo apt-get install postgresql-14

# 2. Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 3. Verify connectivity
psql -h localhost -U postgres -c "SELECT version();"

# 4. Create all service databases
# Run from repo root:
cd schema && bash create_all_databases.sh
# OR manually:
createdb tejoma_identity
createdb tejoma_candidate
createdb tejoma_job
# ... (20 databases total - see docker-compose.yml for full list)

# 5. Run migrations for each service
for service in identity-service platform-governance-service ...; do
  cd $service
  npm run migrate
  cd ..
done
```

**Verification**:
```bash
psql -h localhost -U postgres -c "SELECT datname FROM pg_database WHERE datname LIKE 'tejoma_%';"
# Should show 20 databases starting with tejoma_
```

### ❌ BLOCKER 2: Analytics Cache May Be Empty

**Issue**: Analytics service falls back to the stopped monolith when cache is empty. This will cause 502 errors.

**Impact**:
- /api/analytics/dashboard will fail
- /api/analytics/job/:id will fail
- /api/analytics/recruiter/me will fail
- /api/analytics/skills will fail

**Resolution - OPTION A (Recommended): Backfill Cache**
```bash
# Navigate to analytics service
cd analytics-service

# Run backfill script to populate cache from production data
npx tsx scripts/backfill-analytics.ts

# Verify cache is populated
psql -U postgres -d tejoma_analytics -c "SELECT COUNT(*) FROM analytics_dashboard_cache;"
# Should return > 0 rows
```

**Resolution - OPTION B: Remove Fallback (Already Done in Monolith)**
The monolith's analytics.routes.ts has been updated to remove fallback to a lower service. The microservice's analytics.routes.ts needs the same fix:

Location: `analytics-service/src/routes/analytics.routes.ts`

Changes:
- Line ~23: Remove `const monolithResult = await getDashboard(companyId);`
- Return 503 "cache not populated" instead of calling monolith
- Apply to all endpoints: dashboard, job/:id, recruiter/me, skills

File patch provided in Section 3.

### ❌ BLOCKER 3: Health Checks Don't Verify Database Connectivity

**Issue**: `/live` endpoints return `{"status":"ok"}` without checking database. Services appear healthy when they can't access their databases.

**Impact**:
- Kubernetes/Docker reports false "ready" status
- Actual database failures not detected until business logic executes
- Cascading failures from database unavailability

**Resolution**:
Update all service `/live` endpoints to include database verification:

```typescript
// In each service's health.routes.ts or equivalent

router.get('/live', async (req, res) => {
  try {
    // Check HTTP startup
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

// NEW: /ready endpoint that checks database
router.get('/ready', async (req, res) => {
  try {
    // Query database
    const result = await db.query('SELECT 1');
    if (result) {
      return res.json({ status: 'ready', database: 'connected' });
    }
    res.status(503).json({ status: 'not-ready', error: 'Database not responding' });
  } catch (error) {
    res.status(503).json({ status: 'not-ready', error: error.message });
  }
});
```

Update docker-compose.yml healthcheck to use `/ready` instead of `/live`:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:PORT/ready"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

### ❌ BLOCKER 4: No Backup/Disaster Recovery Procedure

**Issue**: No documented backup strategy. Zero protection against data loss.

**Impact**:
- Data loss from database corruption or failure
- No recovery path from ransomware
- No point-in-time restore capability
- No tested disaster recovery procedure

**Resolution**:
Implement automated PostgreSQL backups:

```bash
# 1. Create backup script: scripts/backup-databases.sh
#!/bin/bash
BACKUP_DIR="/backups/postgresql/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

# Backup all databases
pg_dump -h localhost -U postgres --all --verbose \
  --file="$BACKUP_DIR/full_backup.sql"

# Also backup to cloud (AWS S3 example)
aws s3 cp "$BACKUP_DIR/full_backup.sql" \
  "s3://tejoma-backups/postgresql/$(date +%Y%m%d_%H%M%S).sql" \
  --sse AES256

# Keep local backups for 7 days
find /backups/postgresql -type f -mtime +7 -delete

echo "Backup complete: $BACKUP_DIR"

# 2. Schedule with cron:
# Edit with: crontab -e
# Add:
0 2 * * * /path/to/scripts/backup-databases.sh >> /var/log/tejoma-backup.log 2>&1

# 3. Create restore script: scripts/restore-databases.sh
#!/bin/bash
BACKUP_FILE="$1"  # Pass backup file as argument

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup_file>"
  exit 1
fi

# Stop services
docker compose down

# Drop and recreate databases
psql -U postgres -c "DROP DATABASE IF EXISTS tejoma_identity CASCADE;"
psql -U postgres -c "DROP DATABASE IF EXISTS tejoma_candidate CASCADE;"
# ... (20 databases)

# Restore
psql -U postgres --file="$BACKUP_FILE"

# Restart services
docker compose up -d

echo "Restore complete from: $BACKUP_FILE"

# 4. Test restore monthly
# Set calendar reminder to test restore procedure

# 5. Document RPO/RTO
# RPO (Recovery Point Objective): 1 hour (backups run every 2 hours at 2 AM)
# RTO (Recovery Time Objective): 30 minutes (restore + service restart)
```

**Verification**:
```bash
# Test backup runs daily
ls -lh /backups/postgresql/ | tail -5

# Test restore procedure monthly
# 1. List available backups
ls /backups/postgresql/

# 2. Test restore on development system
./scripts/restore-databases.sh /backups/postgresql/20260810_020000/full_backup.sql

# 3. Verify data integrity
psql -U postgres -d tejoma_identity -c "SELECT COUNT(*) FROM users;"
```

---

## SECTION 2: HIGH-PRIORITY ISSUES (Complete Before Production)

### HIGH 1: Secrets in .env.local (Security Risk)

**Current**: API keys, database passwords stored in `.env.local` file

**Remediation**:
```bash
# 1. Move secrets to AWS Secrets Manager
aws secretsmanager create-secret \
  --name tejoma/production \
  --secret-string '{
    "DB_PASSWORD": "...",
    "JWT_SECRET": "...",
    "GEMINI_API_KEY": "...",
    "GMAIL_APP_PASSWORD": "...",
    "TWILIO_AUTH_TOKEN": "..."
  }'

# 2. Update startup to retrieve secrets
# In docker-compose.yml or deployment script:
# Use AWS SDK to fetch secrets before starting services

# 3. Ensure .env.local is in .gitignore
echo ".env.local" >> .gitignore
git rm --cached .env.local 2>/dev/null
```

### HIGH 2: No Circuit Breakers for Service Calls

**Issue**: Service-to-service calls don't have circuit breakers. One slow service can cascade failures.

**Remediation**:
```typescript
// Example: Add circuit breaker to job-service calls
import CircuitBreaker from 'opossum';

const jobServiceBreaker = new CircuitBreaker(
  async (path: string) => {
    return fetch(`${JOB_SERVICE_URL}${path}`);
  },
  {
    timeout: 30000,           // 30 second timeout
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  }
);

// Use in service calls:
try {
  const response = await jobServiceBreaker.fire('/api/jobs/search');
} catch (error) {
  // Circuit open: service unavailable
  logger.warn('Job service circuit breaker open');
  return res.status(503).json({ error: 'Job service temporarily unavailable' });
}
```

### HIGH 3: Database Connection Failures Not Handled

**Issue**: Transient database failures cause immediate request failures. No retry logic.

**Remediation**:
```typescript
// Add exponential backoff retry for database operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms
        const delayMs = 100 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError;
}

// Usage:
const user = await withRetry(() => 
  db.query('SELECT * FROM users WHERE id = $1', [userId])
);
```

### HIGH 4: Monolith Fallback Still Enabled

**Issue**: API Gateway has `MONOLITH_FALLBACK_ENABLED=true` (default). Unmigrated routes will attempt to call stopped monolith.

**Remediation**:
```bash
# In .env.local for production:
MONOLITH_FALLBACK_ENABLED=false

# This will:
# - Return 404 for unmigrated routes instead of trying monolith
# - Force identification of any remaining unmigrated functionality
# - Enable true microservices-only deployment
```

Before disabling fallback, audit all routes:
```bash
# Test all API endpoints to ensure they're routed explicitly
curl -X GET https://localhost/api/auth/me       # identity-service ✅
curl -X GET https://localhost/api/jobs/1        # job-service ✅
curl -X GET https://localhost/api/candidates    # candidate-core-service ✅
# ... (39 total routes in proxy.routes.ts)

# Any 404 response indicates unmigrated functionality
```

---

## SECTION 3: Code Fixes Required

### Fix 1: Analytics Service Monolith Fallback (Microservice)

**File**: `analytics-service/src/routes/analytics.routes.ts`

Apply these changes:

```typescript
// BEFORE (remove these imports):
import { getDashboard, getJobAnalytics, getRecruiterProfile, getSkills, MonolithProxyError } 
  from '../services/monolithClient.js';

// AFTER (new imports - monolith client removed):
// (none needed - use local db only)

// Dashboard endpoint change:
// BEFORE:
if (!stats || (stats.total_reviewed === 0 && stats.totalCandidatesReviewed === 0)) {
  const monolithResult = await getDashboard(companyId);
  return res.json(monolithResult);
}

// AFTER:
if (!stats) {
  return res.status(503).json({ error: 'Analytics cache not yet populated. Run backfill script.' });
}

// Job analytics endpoint change:
// BEFORE:
if (!stats || stats.total_reviewed === 0) {
  const result = await getJobAnalytics(job_id, companyId);
  return res.json(result);
}

// AFTER:
if (!stats) {
  return res.json({ total_reviewed: 0, acceptance_rate: 0, skillDistribution: [] });
}

// Recruiter profile change:
// BEFORE:
if (!profile || profile.swipesCount === 0) {
  const result = await getRecruiterProfile(...);
  if (!result) return res.status(404)...
  return res.json(result);
}

// AFTER:
if (!profile) {
  return res.status(404).json({ error: 'Recruiter profile not found' });
}

// Skills change:
// BEFORE:
if (!skillDistribution || skillDistribution.length === 0) {
  const result = await getSkills(companyId);
  return res.json(result.skillDistribution.map(...));
}

// AFTER:
res.json((skillDistribution || []).map(...));
```

### Fix 2: Update All Service Health Checks

Add `/ready` endpoint to each service that checks database connectivity.

See BLOCKER 3 section above for template code.

---

## SECTION 4: Pre-Deployment Checklist

### Infrastructure Setup
- [ ] PostgreSQL 14+ installed and running
- [ ] All 20 databases created
- [ ] Database migrations run for all services
- [ ] Backups configured and first backup successful
- [ ] Backup restore procedure tested (dry run)

### Application Configuration
- [ ] `.env.local` created with production values
- [ ] `MONOLITH_FALLBACK_ENABLED=false` set
- [ ] Secrets moved to secrets management (not in .env.local)
- [ ] SSL certificates obtained/configured
- [ ] DNS records updated to point to deployment host

### Analytics Data
- [ ] Analytics cache backfilled (or fallback disabled)
- [ ] Verified analytics queries return data

### Security
- [ ] JWT secret changed from default
- [ ] Database password changed from default "3268"
- [ ] All API keys updated to production values
- [ ] HTTPS configured with valid certificate
- [ ] Rate limiting configured appropriately

### Testing
- [ ] Full regression test suite passes
- [ ] End-to-end workflow tests pass:
  - [ ] User registration
  - [ ] Login
  - [ ] Job search
  - [ ] Candidate matching
  - [ ] Recruiter decisions
  - [ ] Analytics dashboard loads
  - [ ] Chat functionality works
  - [ ] Resume upload/download works
- [ ] All 39 API routes tested for responses
- [ ] Error scenarios tested (service failures, database down)

### Monitoring
- [ ] Prometheus configured and scraping metrics
- [ ] Grafana dashboards created and saved
- [ ] Alert thresholds configured
- [ ] Log aggregation setup (if using centralized logging)

### Documentation
- [ ] Operations runbook created
- [ ] Incident response procedures documented
- [ ] Backup/restore procedures documented and tested
- [ ] Team trained on operational procedures

---

## SECTION 5: Deployment Steps

### 1. Final Pre-Deployment Verification
```bash
# Verify all prerequisites
./scripts/deployment-verification.sh

# Expected output:
# PostgreSQL running: ✅
# Databases exist: ✅ (20/20)
# Migrations complete: ✅ (20/20)
# Backups configured: ✅
# All secrets configured: ✅
```

### 2. Build Docker Images
```bash
docker compose build --no-cache

# Expected: All 24 service images build successfully
# Check: docker images | grep tejoma | wc -l
# Should show: 24 images
```

### 3. Start Services
```bash
docker compose up -d

# Expected: All services start and become healthy within 60 seconds
# Check: docker compose ps | grep -c "healthy"
# Should show: 24 (or more, including infrastructure)
```

### 4. Verify Health
```bash
# Check all services healthy
docker compose ps | grep -v healthy

# If any services are not healthy, check logs:
docker compose logs <service-name> --tail 50

# Common issues:
# - Database connection refused → PostgreSQL not running
# - Cannot connect to Redis → Redis not started
# - Health check timeout → Service starting up (wait 30 seconds)
```

### 5. Smoke Tests
```bash
# Test critical workflows
./scripts/smoke-tests.sh

# Expected: All tests pass
# Test list:
# - Authentication (login endpoint works)
# - Job search (can list jobs)
# - Candidate discovery (can find candidates)
# - Matching (can generate matches)
# - Analytics (dashboard loads)
```

### 6. Monitor for 24 Hours
```bash
# Watch logs for errors
docker compose logs -f | grep -i error

# Monitor metrics
# Access Grafana: http://localhost:3000
# Check: CPU usage, memory, database connections

# Monitor for issues:
# - Connection timeouts
# - Memory leaks
# - Disk space usage
# - Database query performance
```

---

## SECTION 6: Post-Deployment Monitoring

### Daily Tasks
- [ ] Check backup completed successfully
- [ ] Review application logs for errors
- [ ] Verify all services still healthy
- [ ] Check disk space usage

### Weekly Tasks
- [ ] Review Grafana dashboards for trends
- [ ] Test disaster recovery procedure
- [ ] Review security logs for suspicious activity

### Monthly Tasks
- [ ] Full regression test suite
- [ ] Backup restoration dry-run
- [ ] Review and update runbooks
- [ ] Analyze performance metrics

---

## SECTION 7: Rollback Procedure

If deployment fails or issues are discovered:

```bash
### Option 1: Rollback All (Return to Monolith)

# 1. Start monolith
docker compose up app -d

# 2. Stop microservices (optional)
docker compose stop api-gateway redis realtime-service

# 3. Update nginx to route to monolith
# Edit: nginx/conf.d/tejoma.conf
# Change upstream to point to app:3006

# 4. Reload nginx
docker compose exec nginx nginx -s reload

### Option 2: Partial Rollback (Individual Service)

# If one microservice is problematic:

# 1. Identify failing service
docker compose ps | grep unhealthy

# 2. Check logs
docker compose logs <service-name> --tail 100

# 3. Restart service
docker compose restart <service-name>

# 4. If restart fails, roll back that service's code:
git revert <commit-hash>
docker compose build <service-name>
docker compose up <service-name> -d

### Option 3: Database Rollback

# If database corruption is suspected:

# 1. Stop all services
docker compose down

# 2. Restore database from backup
./scripts/restore-databases.sh /backups/postgresql/20260810_020000/full_backup.sql

# 3. Restart services
docker compose up -d
```

---

## SECTION 8: Success Criteria

Deployment is successful when:

1. ✅ All 24 microservices report healthy status
2. ✅ All 20 databases are accessible and populated
3. ✅ All 39 API routes respond correctly
4. ✅ Complete user workflow works end-to-end
5. ✅ Analytics dashboard displays data
6. ✅ Real-time events (WebSocket) connected successfully
7. ✅ Backup runs successfully and can be restored
8. ✅ Zero errors in application logs (after 24-hour monitoring)
9. ✅ Performance metrics show acceptable latency (<500ms p95)
10. ✅ Security scanning shows no critical vulnerabilities

---

## SECTION 9: Final Sign-Off

**Deployment Status**: Ready for production deployment after completing all items in Section 1

**Estimated Time to Production**:
- PostgreSQL setup: 2-4 hours
- Database migrations: 1-2 hours  
- Analytics backfill: 1-2 hours
- Code fixes: 2-4 hours
- Testing & verification: 4-8 hours
- **Total: 10-20 hours**

**Risk Level**: MEDIUM (PostgreSQL and backup procedures are critical)

**Rollback Capability**: HIGH (monolith can be restarted, databases can be restored from backup)

---

**Prepared**: 2026-08-11  
**Status**: AWAITING CRITICAL BLOCKER RESOLUTION  
**Next Step**: Begin Section 1 remediation  

