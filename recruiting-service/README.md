# Recruiting Service

Tier 0 microservice (Batch 19 of the Tejoma enterprise architecture series). A deliberately
partial extraction of the Recruiting bounded context - owns `recruiter_notifications`, proxies
`GET /api/matches` to the monolith.

## Status

**Current batch (19):** fully implemented, not yet cut over. Real traffic still goes to the
monolith directly; API Gateway is not yet the production entry point.

## Why this extraction is partial

A Batch 19 domain audit read every `src/api/recruiter-*.routes.ts` and `src/api/swipe.routes.ts`/
`job.routes.ts`/`candidate-search.routes.ts` file in the monolith. Four of the six recruiter-facing
route files (`job.routes.ts`, `swipe.routes.ts`, `recruiter-review.routes.ts`,
`candidate-search.routes.ts`) have deep, synchronous, hot-path coupling to the not-yet-extracted
Matching domain (`rankCandidatesForJob`, `calculateMatchScore`, `computeMatchExplanation`,
`generateRubricReport`). Extracting them now would mean either a forbidden big-bang (pulling the
entire Matching domain in at the same time) or a hollow proxy-only shell with no real ownership.

The other two - `recruiter-matches.routes.ts` and `recruiter-notifications.routes.ts` - are
genuinely clean: both files' own header comments already stated they were built "brand-new,
standalone... so swipe.routes.ts/recruiter-review.routes.ts are never touched." This batch
extracts exactly those two. Job/swipe/review/search extraction is deferred until Matching Service
exists (planned as the next-but-one batch) and can be proxied against, per the "or equivalent if
the audit finds better bounded contexts" latitude this migration series operates under.

## What this service owns vs. proxies

- **Owns directly** (own database, own migration): `recruiter_notifications` - the recruiter-facing
  notification feed created when a mutual match forms. Mirrored in real time from the monolith via
  `dualWrite.ts` once `DUAL_WRITE_ENABLED=true`.
- **Proxies to the monolith** (`src/services/monolithClient.ts` → the monolith's new
  `/internal/recruiting/*` API): `GET /api/matches`. `getRecruiterMatches()` joins
  `mutual_matches`+`jobs`+`candidates`+`recruiter_notifications` - only the last of those four
  tables is owned here, so the other three genuinely still belong to the monolith's
  Recruiting/Matching domain (Batch 19 domain audit).

## Auth model

Verifies the same HS256 staff token `src/utils/tokens.ts`'s `signAccessToken` issues today (shared
`JWT_SECRET`), not a JWKS scheme - identical reasoning to `jd-parser-service`/`chat-service`. Both
routes this service exposes are recruiter/admin only; there is no candidate-facing surface here.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database and
`MONOLITH_INTERNAL_URL` for the proxied matches data.

## Architecture references

- Service scope and ownership: Batch 19 domain audit (this README's "Why this extraction is
  partial" section).
- Migration methodology: `MIGRATION_RUNBOOK.md` section 6e.
