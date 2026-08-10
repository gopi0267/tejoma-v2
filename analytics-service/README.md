# Analytics Service

Tier 0 microservice (Batch 22 of the Tejoma enterprise architecture series). Owns nothing
directly - a pure proxy over the monolith's recruiter/admin dashboard analytics.

## Status

**Current batch (22):** fully implemented, not yet cut over. Real traffic still goes to the
monolith directly; API Gateway is not yet the production entry point.

## Why this is proxy-only

Every route in this service (`GET /analytics/dashboard`, `/analytics/job/:job_id`,
`/analytics/recruiter/me`, `/analytics/skills`) is pure SQL aggregation over `swipes`, `jobs`,
`candidates`, and `users` (Batch 22 domain audit) - none of which this service owns, or could
sensibly own a copy of, since the underlying tables are scattered across domains this migration
hasn't unified yet. Rather than a hollow shell with a database it never uses, this service is
honestly proxy-only: every route calls the monolith's new `/internal/analytics/*` API
(`src/api/analytics-internal.routes.ts`), a thin wrapper around the unchanged `db.ts` functions.

## What's deliberately NOT extracted here

Two lookalike files stay on the monolith:

- `candidate-analytics.routes.ts` calls `computeMatchFeatures`/`computeFeatureScore` (the live
  matching engine) directly, including counterfactual re-scoring for its recommendations.
- `proficiency-analytics.routes.ts` reads from the Matching domain's shadow-scoring subsystem
  (`src/matching/proficiencyAnalytics.ts`, `shadowDataHealth.ts`).

Both are genuinely coupled to the not-yet-extracted Matching Service, the same "defer until
Matching exists" reasoning Recruiting Service (Batch 19) already applied to job/swipe/review/
search.

## Auth model

Verifies the same HS256 staff token `src/utils/tokens.ts`'s `signAccessToken` issues today (shared
`JWT_SECRET`), not a JWKS scheme - identical reasoning to `jd-parser-service`/`chat-service`.
Recruiter or admin, matching the monolith's own `analytics.routes.ts` (not admin-only - regular
recruiters use these dashboards today).

## Local development

```
npm install
npm run dev
```

Requires `MONOLITH_INTERNAL_URL` (required, not graceful-null - this service has no fallback path
of its own for any route). No database configuration needed.

## Architecture references

- Service scope and ownership: Batch 22 domain audit (this README's "Why this is proxy-only").
- Migration methodology: `MIGRATION_RUNBOOK.md` §6g.
