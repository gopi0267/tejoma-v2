# Candidate Service

Tier 0 microservice (Batch 16 of the Tejoma enterprise architecture series, extended by Batch 20).
Owns the candidate self-service bounded context: profile, work-experience history, notifications,
job discovery, applications, decisions, and matches.

## Status

**Current batches (16, 20):** fully implemented, not yet cut over. Real traffic still goes to the
monolith directly (nginx, `DEPLOYMENT.md`, unchanged); API Gateway is not yet the production entry
point.

## What this service owns vs. proxies

- **Owns directly** (own database, own migrations): `candidate_accounts` (profile columns -
  headline, skills, experience, education, certifications, tools, languages, CTC/notice
  preferences, onboarding fields), `candidate_experiences`, and `candidate_notifications` (Batch
  20 - `migrations/002_notifications.up.sql`). The monolith's `dualWrite.ts` mirrors every write
  into this database in real time once `DUAL_WRITE_ENABLED=true`. `candidate_notifications` is the
  one table in this whole migration series that keeps a REAL foreign key to another table this
  service owns (`candidate_account_id` → `candidate_accounts`, both local) rather than the usual
  cross-service-FK-elimination pattern - see that migration's header comment.
- **Proxies to the monolith** (`src/services/monolithClient.ts` → the monolith's new
  `/internal/candidate/*` API): job discovery/detail/match-explanation, decisions (swipe/apply)
  and their recruiter-match fan-out, applications, and matches. These genuinely still belong to
  the monolith's Recruiting/Matching domain - `candidate_decisions`/`mutual_matches` have real
  foreign keys into `jobs`/`candidates`/`companies`, none of which this service owns yet (Batch 16
  domain audit). Proxying preserves 100% identical business behavior (same validation, same
  recruiter-swipe fan-out, same response shapes) without duplicating that logic - see
  `src/api/candidate-internal.routes.ts` in the monolith for what's on the other end.
- **Does not own and never will, per this migration's own scope**: candidate auth/refresh tokens
  (Identity Service's concern), resume parsing/storage, JD parsing, chat, analytics, or anything
  recruiter-facing (Recruiting Service's concern, Batch 19).

## Auth model

Verifies the same HS256 candidate token `src/utils/tokens.ts`'s `signCandidateAccessToken` issues
today (shared `JWT_SECRET`), not a JWKS scheme - identical reasoning to `jd-parser-service`
(Batch 15): candidate auth has not cut over to Identity Service yet.

## Local development

```
npm install
npm run migrate   # applies migrations/001_initial_schema.up.sql, 002_notifications.up.sql
npm run dev
```

Requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` pointed at this service's own
database, and `MONOLITH_INTERNAL_URL` pointed at a running monolith (for the proxied routes).
`JWT_SECRET` falls back to the same dev-only default `src/utils/tokens.ts` uses.

## Architecture references

- Service scope and ownership: Batch 16 domain audit, extended by Batch 20.
- Migration methodology: `MIGRATION_RUNBOOK.md` §6b, §6b-i.
