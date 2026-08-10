# Matching Decision Service

Tier 0 microservice (full-migration batch). Owns dual-written, read-only mirrors of `swipes`,
`recruiter_notes`, and `detailed_scoring_reports` - the outcome data recorded once a real
recruiter decision or review action happens.

## Status

Fully implemented, not cut over. The monolith remains the sole writer for all three tables -
`swipe.routes.ts`'s `recordSwipe` and `recruiter-review.routes.ts`'s `upsertRecruiterNote`/
`upsertDetailedScoringReport` are unchanged. This service's own real, complete read endpoints are
served from its own database - not yet gateway-routed to any real caller.

## Deliberately does NOT touch the live-scoring engine

`swipe.routes.ts` and `recruiter-review.routes.ts` both synchronously call `rankCandidatesForJob`/
`scoreCandidateForJob` (`services.ts`/`matchingApi.ts`) to compute the score being recorded in the
same request. That scoring engine is the single highest-blast-radius piece of this whole system -
deeply interconnected, hard to test exhaustively, and the one component this migration has
consistently held back from touching without a dedicated design pass (see
`MIGRATION_RUNBOOK.md`'s full-migration section). This service mirrors only the RESULT of a
decision already made and recorded by the unchanged monolith code - never the computation itself.
This is the same "mirror real data safely, never rush the algorithm" discipline every batch in
this migration has held.

## What this service owns

- **Owns dual-written, read-only-from-this-service's-own-code mirrors**: `swipes`,
  `recruiter_notes`, `detailed_scoring_reports`. The monolith remains the sole writer -
  `upsertSwipe`/`upsertRecruiterNote`/`upsertDetailedScoringReport` in `db.ts` exist only as
  dual-write's targets.
- **Real reads**: `GET /internal/swipes?companyId=`, `GET /internal/recruiter-notes?companyId=&candidateId=&jobId=`,
  `GET /internal/detailed-scoring-reports?companyId=&candidateId=&jobId=` - plain outcome data,
  tenant-isolated.

## No auth, no gateway routing yet, no `MONOLITH_INTERNAL_URL`

Same "built and validated, ready for a future caller" status Role Intelligence Service (Batch 29),
Job Service, and Candidate Core Service started at.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database. No
external service dependency.

## Architecture references

- Service scope and the "mirror the outcome, not the algorithm" decision: this README.
- Migration methodology: `MIGRATION_RUNBOOK.md`'s full-migration section.
