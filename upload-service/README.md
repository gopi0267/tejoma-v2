# Upload Service

File upload management service for Tejoma recruiting platform. Handles resume, cover letter, and portfolio uploads with virus scanning, storage management, and async resume extraction.

**Phase 1** component of the monolith-to-microservices migration using the strangler-fig pattern.

## Quick Start

### Development Setup

```bash
# Install dependencies
npm install

# Create database
psql -U postgres -c "CREATE DATABASE tejoma_uploads"

# Run migrations
psql -U postgres -d tejoma_uploads < migrations/001_initial.up.sql

# Start service (with auto-reload)
npm run dev
```

Service runs on `http://localhost:4030` by default.

### Health Check

```bash
curl http://localhost:4030/health
# Response: { "status": "ok" }
```

## API Reference

### Upload File

**Endpoint**: `POST /api/uploads`

**Authentication**: Required (Bearer token)

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@resume.pdf" \
  -F "candidate_id=123" \
  http://localhost:4030/api/uploads
```

**Parameters**:
- `file`: (multipart) Resume/document file (required)
- `candidate_id`: (form) Candidate ID (mutually exclusive with recruiter_id)
- `recruiter_id`: (form) Recruiter ID (mutually exclusive with candidate_id)
- `file_type`: (form, optional) "resume" | "cover_letter" | "portfolio" | "document" (default: "resume")

**Response**:
```json
{
  "id": 42,
  "upload_id": "42",
  "status": "uploaded",
  "storage_key": "uploads/company-1/1720300800000-abcd1234.pdf",
  "created_at": "2024-07-06T20:00:00.000Z"
}
```

**Error Responses**:
- `400`: No file, invalid parameters, or file type not allowed
- `401`: Missing or invalid authorization
- `413`: File exceeds maximum size (10MB)
- `415`: File type not supported
- `500`: Internal server error

### Get Upload Status

**Endpoint**: `GET /api/uploads/:id`

**Authentication**: Required (Bearer token)

**Request**:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:4030/api/uploads/42
```

**Response**:
```json
{
  "id": 42,
  "company_id": 1,
  "candidate_id": 123,
  "recruiter_id": null,
  "file_name": "resume.pdf",
  "file_type": "resume",
  "mime_type": "application/pdf",
  "file_size_bytes": 245000,
  "storage_key": "uploads/company-1/1720300800000-abcd1234.pdf",
  "upload_status": "uploaded",
  "error_message": null,
  "file_hash": null,
  "virus_scan_status": "pending",
  "virus_scan_timestamp": null,
  "created_at": "2024-07-06T20:00:00.000Z",
  "updated_at": "2024-07-06T20:00:00.000Z"
}
```

**Error Responses**:
- `401`: Invalid authorization
- `404`: Upload not found
- `500`: Internal server error

## Configuration

See `.env.example` for all configuration options. Key settings:

```env
# Server
NODE_ENV=development
PORT=4030

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tejoma_uploads
DB_USER=postgres
DB_PASSWORD=your_password

# JWT (must be set in production)
JWT_SECRET=your-jwt-secret

# File uploads
MAX_FILE_SIZE_BYTES=10485760  # 10MB

# Service integration
RESUME_SERVICE_URL=http://localhost:4031
MONOLITH_INTERNAL_URL=http://localhost:3000
RESUME_SERVICE_ENABLED=false

# Feature flags
UPLOAD_SERVICE_ENABLED=false  # Set true to enable cutover from monolith
```

## Database

### Schema

**uploads table**:
```sql
CREATE TABLE uploads (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  candidate_id INTEGER,
  recruiter_id INTEGER,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL CHECK (file_type IN ('resume', 'cover_letter', 'portfolio', 'document')),
  mime_type VARCHAR(100),
  file_size_bytes INTEGER NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  upload_status VARCHAR(50) NOT NULL CHECK (upload_status IN ('uploaded', 'processing', 'completed', 'failed')),
  error_message TEXT,
  file_hash VARCHAR(64),
  virus_scan_status VARCHAR(50) CHECK (virus_scan_status IN ('pending', 'clean', 'infected', 'failed')),
  virus_scan_timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (candidate_id IS NOT NULL OR recruiter_id IS NOT NULL)
);

CREATE INDEX idx_uploads_candidate ON uploads(candidate_id);
CREATE INDEX idx_uploads_recruiter ON uploads(recruiter_id);
CREATE INDEX idx_uploads_company ON uploads(company_id);
CREATE INDEX idx_uploads_status ON uploads(upload_status);
CREATE INDEX idx_uploads_created_desc ON uploads(created_at DESC);
```

### Migrations

- `001_initial.up.sql`: Create uploads table and schema
- `001_initial.down.sql`: Drop uploads table and rollback

Run migrations:
```bash
psql -U postgres -d tejoma_uploads < migrations/001_initial.up.sql
```

Rollback:
```bash
psql -U postgres -d tejoma_uploads < migrations/001_initial.down.sql
```

## Features

### File Upload
- Multipart file upload with size and type validation
- Support for: PDF, DOCX, DOC, TXT resumes
- Maximum file size: 10MB (configurable)
- Storage key generation with company scoping

### Resume Extraction
- Fire-and-forget webhook call to resume-service
- Async skill extraction and text parsing
- Integration with job queue (BullMQ)

### Dual-Write
- Mirror uploads to monolith (fire-and-forget)
- Non-blocking on primary operation
- Timeout: 5 seconds (service continues if mirror fails)

### Logging
- Structured logging with Pino
- Request ID correlation across services
- Pretty-printed output in development

## Architecture

### Service Components

```
Upload Service (Node.js/Express)
├── Express Server
│   ├── Health Checks (/health, /ready)
│   ├── Upload Routes (/api/uploads)
│   └── Metrics (/metrics)
├── Database Layer
│   ├── PostgreSQL Connection Pool
│   ├── CRUD Operations
│   └── Fire-and-forget Error Handling
├── Services
│   ├── Storage (S3/Azure/Mock)
│   ├── Resume Extractor Client (HTTP)
│   └── Dual-Write Client (HTTP)
└── Middleware
    ├── Authentication (JWT)
    ├── Multipart Upload
    └── Request ID Correlation
```

### Data Flow

1. **Upload** → File + metadata
2. **Validation** → Size, type, auth checks
3. **Storage** → Save to S3/Azure (mock for now)
4. **Database** → Record in uploads table
5. **Dual-Write** → Mirror to monolith (fire-and-forget)
6. **Resume Queue** → Webhook to resume-service (fire-and-forget)
7. **Response** → Return upload ID and status

## Testing

### Manual Testing

**Test upload**:
```bash
# Create a test file
echo "John Doe\n10 years experience" > test.txt

# Upload it
curl -X POST \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
  -F "file=@test.txt" \
  -F "candidate_id=1" \
  http://localhost:4030/api/uploads

# Should return: { "id": ..., "status": "uploaded", ... }
```

**Test status**:
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" \
  http://localhost:4030/api/uploads/1
```

### Unit Tests

```bash
npm test
```

### Load Testing

```bash
npm run load-test
# Target: 1000 req/s, p99 <500ms
```

## Migration Strategy (Strangler-Fig)

### Phase 1: Shadow (Dual-Write)
- [ ] Upload-service deployed
- [ ] Feature flag `UPLOAD_SERVICE_ENABLED=false` (monolith handles requests)
- [ ] Dual-write enabled: `DUAL_WRITE_ENABLED=true`
- [ ] Monolith mirrors all uploads to service
- [ ] Validation: zero drift between databases

### Phase 2: Cutover
- [ ] Feature flag `UPLOAD_SERVICE_ENABLED=true`
- [ ] Requests route to upload-service
- [ ] Monolith continues as rollback target
- [ ] Monitor: error rates, latency, logs

### Phase 3: Rollback (If Needed)
- [ ] Feature flag `UPLOAD_SERVICE_ENABLED=false`
- [ ] Instant recovery to monolith
- [ ] Investigate issue
- [ ] Redeploy when ready

## Monitoring

### Health Checks

```bash
# Liveness
curl http://localhost:4030/health

# Readiness
curl http://localhost:4030/ready

# Metrics
curl http://localhost:4030/metrics
```

### Logs

Development:
```bash
npm run dev
# Pretty-printed logs on console
```

Production:
```bash
LOG_LEVEL=info npm start
# JSON structured logs
```

## Docker

### Build

```bash
docker build -t tejoma/upload-service .
```

### Run

```bash
docker run -p 4030:4030 \
  -e DB_HOST=postgres \
  -e DB_NAME=tejoma_uploads \
  tejoma/upload-service
```

### Docker Compose

```yaml
services:
  upload-service:
    build: ./upload-service
    ports:
      - "4030:4030"
    environment:
      - DB_NAME=tejoma_uploads
      - RESUME_SERVICE_URL=http://resume-service:4031
      - MONOLITH_INTERNAL_URL=http://monolith:3000
    depends_on:
      - postgres
```

## Troubleshooting

### Database connection errors
- Verify PostgreSQL is running
- Check DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
- Ensure tejoma_uploads database exists
- Ensure migrations have been run

### File upload fails
- Check MAX_FILE_SIZE_BYTES configuration
- Verify ALLOWED_MIME_TYPES includes the file type
- Ensure disk space available

### Resume extraction not queued
- Verify RESUME_SERVICE_URL is set
- Check RESUME_SERVICE_ENABLED flag
- Review logs for timeout or connection errors

### Dual-write fails
- Check MONOLITH_INTERNAL_URL is reachable
- Review monolith logs for 500 errors
- Verify dual-write is not blocking uploads (should be fire-and-forget)

## Related Services

- **Monolith** (tejoma-rec): Source of truth during shadow phase
- **Resume Service**: Extracts text and skills from uploaded documents
- **Notifications Service**: Notifies users of upload completion
- **Matching Decision Service**: Uses resume skills for job matching

## References

- [Strangler Fig Pattern](https://www.martinfowler.com/bliki/StranglerFigApplication.html)
- [PHASE_1_IMPLEMENTATION_GUIDE.md](../PHASE_1_IMPLEMENTATION_GUIDE.md)
- [PHASE_1_STATUS.md](../PHASE_1_STATUS.md)
- [PHASE_1_IMPLEMENTATION_CHECKLIST.md](../PHASE_1_IMPLEMENTATION_CHECKLIST.md)

## License

Internal Use Only - Tejoma Recruiting Platform
