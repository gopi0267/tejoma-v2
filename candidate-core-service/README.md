# Candidate Core Service

Tier 0 microservice (full-migration batch). Owns a dual-written, read-only mirror of the
monolith's `candidates` table - the recruiter-facing, resume-parsed candidate profile.

## Not the same thing as `candidate-service`

`candidate-service` (Batch 16) owns `candidate_accounts` - the candidate's own self-service
login/profile. This service owns `candidates` - a completely different table, populated by resume
parsing and recruiter-side CRUD (`candidate.routes.ts`), read by the matching engine, swipe/review
flow, and candidate search. The two share the word "candidate" but are different bounded contexts,
confirmed by reading both tables' real schemas before building this service.

## Status

Fully implemented, not cut over. The monolith remains the sole writer -
`candidate.routes.ts`'s `createCandidate`/`updateCandidate`/`deleteCandidate` are unchanged. This
service's own `/internal/candidates` and `/internal/candidates/:id` are real, complete reads served
from its own database - not yet gateway-routed to any real caller.

## Why this is a mirror, not a cutover

`candidate.routes.ts`'s create/update path calls `computeCandidateConfidence`
(`confidenceService.ts`), `indexCandidateEmbeddingInBackground` (`embeddingIndex.ts`), RAG
indexing, unknown-skill discovery, and reasoning computation - none of which are extracted.
`swipe.routes.ts`, `recruiter-review.routes.ts`, `candidate-search.routes.ts`, and `upload.routes.ts`
all read/write `candidates` directly today. Making this service the sole owner in one batch would
require repointing every one of those call sites simultaneously - the same high-blast-radius risk
job-service's own README documents for `jobs`. The dual-write mirror gets a real, complete,
continuously-synced copy into an independently-owned database with zero risk to existing behavior.

## What this service owns

- **Owns a dual-written, read-only-from-this-service's-own-code mirror**: `candidates`. The
  monolith remains the sole writer - `upsertCandidate`/`patchCandidate`/`deleteCandidateMirror` in
  `db.ts` exist only as dual-write's targets. The mirrored row is the monolith's RAW stored
  representation (`skills`/`previous_companies`/`certifications` as delimited strings) - the
  monolith's own `mapRowToCandidate` parses these into arrays only at its own read boundary, out of
  scope here.
- **Real reads**: `GET /internal/candidates?companyId=`, `GET /internal/candidates/:id?companyId=`
  - plain candidate data, no scoring/confidence/embedding fusion. Tenant-isolated.

## No auth, no gateway routing yet, no `MONOLITH_INTERNAL_URL`

Same "built and validated, ready for a future caller" status Role Intelligence Service (Batch 29)
and Job Service started at.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database. No
external service dependency.

## Architecture references

- Service scope and the mirror-not-cutover decision: this README.
- Migration methodology: `MIGRATION_RUNBOOK.md`'s full-migration section.
