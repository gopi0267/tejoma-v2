# Resume Service

Tier 0 microservice (Batch 18 of the Tejoma enterprise architecture series). Owns resume text
extraction, the Gemini-based two-pass parsing pipeline, and permanent resume file storage.

## Status

**Current batch (18):** fully implemented, not yet cut over. Real traffic still goes to the
monolith directly; API Gateway is not yet the production entry point.

## What this service owns

- The full parsing pipeline: `services/parser.service.ts` (Gemini two-pass extract + audit),
  `services/textExtraction.ts` (PDF/DOCX/TXT text extraction), and the regex-only fallback
  extractors (`emailExtractor.ts`, `phoneExtractor.ts`, `skillsExtractor.ts`, `nameExtractor.ts`,
  `dateParser.ts`) - all ported verbatim from the monolith's root-level `parser.service.ts` and
  `src/api/upload.routes.ts`.
- Two auth-gated route surfaces sharing that one pipeline: candidate-facing
  (`POST /candidate-resume/parse`, `POST`/`GET /candidate-resume/file`) and recruiter-facing
  (`POST /parse-resume`, bulk upload). This is the first Tier 0 service needing both staff and
  candidate auth in one process - see `src/middleware/auth.middleware.ts`.
- Permanent file storage, behind `services/storage/StorageAdapter.ts` - see that file's header
  comment for why only a local-disk implementation exists today and what's needed before this can
  run as more than one replica.

## What this service does NOT own

The candidate's `resume_file_path`/`resume_original_filename`/`resume_file_uploaded_at` still
live on `candidate_accounts`, which is monolith-authoritative until cutover (Candidate Service,
Batch 16, only mirrors them via dual-write). This service calls the monolith's new
`/internal/resume/*` API for those - see `src/services/monolithClient.ts`.

## A known, disclosed limitation (not fixed by this batch)

Local-disk storage means resume files only exist on whichever pod handled the upload - this
service cannot safely run more than one replica in Kubernetes until a real object-storage backend
(S3) is wired in behind `StorageAdapter.ts`. This is the same limitation the monolith already has
today (one process, one disk); this batch does not make it worse, and does not claim to have
solved it - real AWS infrastructure is a prerequisite for that, not something buildable without it.

## Auth model

Verifies the same HS256 tokens (`src/utils/tokens.ts`'s `signAccessToken` for staff,
`signCandidateAccessToken` for candidates) the monolith issues today - not a JWKS scheme. Same
reasoning as every other Tier 0 service that predates the real auth cutover.

## Local development

```
npm install
npm run dev
```

Requires `MONOLITH_INTERNAL_URL` and a real `GEMINI_API_KEY` (required, not optional - parsing is
this service's entire purpose). `JWT_SECRET` falls back to the same dev-only default
`src/utils/tokens.ts` uses. `RESUME_STORAGE_DIR`/`TEMP_UPLOAD_DIR` default to `uploads/candidate-
resumes` and `uploads`, matching the monolith's own paths.

## Architecture references

- Service scope and ownership: Batch 18 domain audit.
- Migration methodology: `MIGRATION_RUNBOOK.md`.
