# Platform Governance Service

Tier 0 microservice (Phase 11/12 of the Tejoma enterprise architecture series). Owns the
moderated company/tenant onboarding workflow: public registration request submission, superadmin
review (list/detail/reject), and the not-yet-implemented approve step (see below).

## Status

**Current batch (10):** submission, listing, detail, and reject are fully implemented against
this service's own database. Approve is explicitly **not implemented** - see
`src/routes/company-requests.routes.ts`'s header comment for the full reasoning: it requires a
cross-service transaction (create a company in Tenant Directory Service + create a user in
Identity Service) that cannot be built until Tenant Directory Service exists (Batch 11).

This is the first Tier 0 service other than Identity Service itself to verify a staff access
token - `src/middleware/staffAuth.middleware.ts` verifies tokens against Identity Service's
published JWKS (`/.well-known/jwks.json`), validating the RS256/JWKS design from
identity-service's Batch 2.

## Architecture references

- Service scope and ownership: Phase 1(domain analysis) section 2, Phase 3(database) section 1
- Migration methodology: Phase 11 section 12 (dual-write / shadow-read / validation / cutover / rollback / legacy removal)
- Cross-service JWT verification: Phase 2(technical) section 3

## Local development

```
npm install
npm run dev
```

Requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` pointed at this service's own
database, and `IDENTITY_SERVICE_URL` (e.g. `http://localhost:4001`) so staff token verification
can reach Identity Service's JWKS endpoint - this is a hard startup requirement, not optional
(see `src/config/env.ts`).

Optional: `TENANT_DIRECTORY_SERVICE_URL` (company-name duplicate pre-check, gracefully degrades
to "unknown" until Tenant Directory Service exists) - `IDENTITY_SERVICE_URL` doubles as the
user-exists duplicate pre-check target too, which likewise gracefully degrades until Identity
Service exposes that internal endpoint (Batch 11).
