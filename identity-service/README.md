# Identity Service

Tier 0 microservice extraction (Phase 11/12 of the Tejoma enterprise architecture series, extended
by Batch 21). Owns staff and candidate authentication - JWT issuance (RS256/JWKS), refresh token
rotation, Google OAuth, OTP verification, RBAC claims - plus staff user management (admin CRUD on
recruiters within their own company, Batch 21).

## Status

**Implemented:** staff auth (login/refresh/logout/logout-all/me), candidate auth, Google OAuth
(staff and candidate), OTP verification, JWKS endpoint, audit logging, and staff user management
(`/api/users/*`, Batch 21). Not yet cut over - `src/api/auth.routes.ts`,
`candidate-auth.routes.ts`, and `users.routes.ts` continue running unchanged in the monolith as the
strangler-fig fallback until a deliberate cutover (`MIGRATION_RUNBOOK.md` §2-§4).

## Architecture references

- Service scope and ownership: Phase 1(domain analysis) section 2, Phase 3(database) section 1
- Migration methodology: Phase 11 section 12 (dual-write / shadow-read / validation / cutover / rollback / legacy removal); `MIGRATION_RUNBOOK.md` §6f for Batch 21's user-management addition.
- JWT signing: RS256 with a published JWKS endpoint (`src/routes/jwks.routes.ts`, `src/config/keys.ts`) - the monolith still signs/verifies with HS256 (`src/utils/tokens.ts`); the token payload contract (`user_id/email/name/company_id/role` for staff, `candidate_id/email/phone/name` for candidates) is unchanged, only the signing algorithm and key-distribution mechanism differ. See `src/config/keys.ts`'s header comment for the production-vs-development key-sourcing split.

## Local development

```
npm install
npm run dev
```

Requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` pointed at the Identity DB
(today, during Tier 0, this may be the same Postgres instance as the monolith, scoped to a
separate database/schema - final target is a dedicated RDS instance per Phase 3(database) section 1).
