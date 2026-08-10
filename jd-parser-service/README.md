# JD Parser Service

Tier 0 microservice (Batch 15 of the Tejoma enterprise architecture series). Owns the JD
(job description) parsing pipeline - turns pasted job description text into structured fields
(skills, experience, salary, location, etc.) via a hybrid regex -> dictionary -> spaCy/GLiNER
pipeline. See `src/jd-parser/README.md` for the pipeline's own internal architecture, tier
breakdown, and benchmark numbers - that document is unchanged from the monolith's copy.

## Status

**Current batch (15):** fully implemented, not yet cut over. This is the safest extraction
identified by the Batch 15 domain audit: zero database access, no cross-domain imports, one
external HTTP dependency (`jd-nlp-service`) that already degrades gracefully.

- API Gateway now routes `POST /api/jobs/parse-description` here (`api-gateway/src/proxy.ts`),
  but the Gateway itself is not yet the production entry point (nginx still points directly at the
  monolith - `DEPLOYMENT.md`, unchanged by this batch). No real traffic reaches this service yet.
- The monolith's own `src/api/jd-parser.routes.ts` and `src/jd-parser/` are untouched and remain
  fully authoritative - per this migration's strangler-fig discipline, nothing is removed from the
  monolith until cutover has been stable in production for a real period
  (`MIGRATION_RUNBOOK.md` section 5).
- Shadow-validation (`src/jdParserShadow.ts` in the monolith) can compare this service's output
  against the monolith's own for real requests, off by default (`SHADOW_JD_PARSER_ENABLED`) -
  see that file's header comment.

## Why this is safe to extract first

Confirmed by the Batch 15 audit and by direct inspection of every import in `src/jd-parser/`
(zero references to `db.ts`, no shared state, no other domain's code):

- No database - the pipeline is a pure function of its input text.
- The one external dependency (`JD_NLP_SERVICE_URL`) is optional by design: `nlpTier.ts` returns
  empty fields rather than throwing if the Python service is unreachable, slow, or down.
- The 563-line existing unit test suite ports over unchanged (same assertions, same fixtures) -
  see `tests/`.

## Auth model (read this before assuming JWKS)

This service verifies the **same HS256 token** `src/utils/tokens.ts` issues today (shared
`JWT_SECRET`), not the RS256/JWKS scheme `platform-governance-service` uses. That's deliberate:
staff auth has not cut over to Identity Service yet, so every real session cookie in production is
still monolith-issued. See `src/config/env.ts` and `src/middleware/auth.middleware.ts` for the
full reasoning. Once auth cuts over, this should switch to the JWKS pattern - not before.

## Local development

```
npm install
npm run dev
```

Optional env: `JWT_SECRET` (falls back to the same dev-only default `src/utils/tokens.ts` uses),
`JD_NLP_SERVICE_URL` (default `http://localhost:8008`), `FRONTEND_URL`, `PORT` (default `4004`).

```
npm test                    # unit tests (Tier 1-2 path, no external dependency)
npm run benchmark           # Tier 1-2 only, matches the monolith's original benchmark numbers
npm run benchmark:with-nlp  # full pipeline, requires jd-nlp-service running
```

## Architecture references

- Service scope and ownership: Batch 15 domain audit ("Coupling map" section - JD Parser Service
  listed as the cleanest, most portable module in the matching/AI domain).
- Migration methodology: `MIGRATION_RUNBOOK.md`.
