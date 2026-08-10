# Job Service

Tier 0 microservice (full-migration batch). Owns a dual-written, read-only mirror of the
monolith's `jobs` table.

## Status

Fully implemented, not cut over. The monolith remains the sole writer - `job.routes.ts`'s
`createJob`/`updateJob`/`deleteJob` are unchanged and continue exactly as today. This service's own
`/internal/jobs` and `/internal/jobs/:id` are real, complete reads served from its own database -
not yet gateway-routed to any real caller.

## Why this is a mirror, not a cutover

`job.routes.ts`'s real `GET /jobs/:id` endpoint fuses plain job data with a live call into the
matching engine (`rankCandidatesForJob`) in the same request, returning `{ job, matched_candidates
}`. `POST/PUT /jobs` trigger background embedding indexing, RAG indexing, unknown-skill discovery,
and reasoning computation. Every one of `swipe.routes.ts`, `recruiter-review.routes.ts`,
candidate-facing job browsing, and analytics also reads `jobs` directly today. Making this service
the sole owner in one batch would require repointing every one of those call sites simultaneously -
exactly the kind of rushed, high-blast-radius change this migration's own discipline avoids. The
dual-write mirror shape (same as `role_profiles`, `skill_nodes`, etc.) gets a real, complete,
continuously-synced copy of `jobs` into an independently-owned database with zero risk to any
existing behavior, and is the correct foundation for a future full cutover once the matching engine
itself is extracted.

## What this service owns

- **Owns a dual-written, read-only-from-this-service's-own-code mirror**: `jobs`. The monolith
  remains the sole writer - `upsertJob`/`patchJob`/`deleteJobMirror` in `db.ts` exist only as
  dual-write's targets.
- **Real reads**: `GET /internal/jobs?companyId=`, `GET /internal/jobs/:id?companyId=` - plain job
  data, no scoring fusion. Tenant-isolated (a job scoped to a different company returns 404).

## No auth, no gateway routing yet, no `MONOLITH_INTERNAL_URL`

Same "built and validated, ready for a future caller" status Role Intelligence Service (Batch 29)
started at - no route in the monolith's frontend contract is safe to repoint here yet without also
moving the scoring fusion those endpoints depend on.

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
