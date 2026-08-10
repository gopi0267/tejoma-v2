# Tenant Directory Service

Tier 0 microservice (Phase 11/12 of the Tejoma enterprise architecture series). Owns the
`companies` table - the tenant/company system of record every other Tier 0 service resolves via
internal API rather than a shared database.

## Status

**Current batch (11):** fully implemented. All four internal endpoints (`GET /internal/companies/
:id`, `GET /internal/companies/exists`, `POST /internal/companies`, `PATCH /internal/companies/
:id/deactivate`) are live and wired as the real target for identity-service's and
platform-governance-service's previously graceful-null clients, and as the company-creation step
of platform-governance-service's now-implemented approve saga.

This service exposes no public-facing API surface at all - only `/internal/*`, meant to be
called service-to-service and gated by network boundary in production (API Gateway not routing
`/internal/*` externally), not by a staff JWT. See `src/config/env.ts`'s header comment.

## Architecture references

- Service scope and ownership: Phase 1(domain analysis) section 2, Phase 3(database) section 1
- Migration methodology: Phase 11 section 12

## Local development

```
npm install
npm run dev
```

Requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` pointed at this service's own
database.
