# Role Intelligence Service

Tier 0 microservice (Batch 29 of the Tejoma enterprise architecture series). The fifth extracted
slice of the "Matching" domain - owns the read-only role-resolution logic: resolving an arbitrary
JD title to the closest known role profile by embedding cosine similarity.

## Status

**Current batch (29):** fully implemented, not cut over, and unlike Reasoning/Skill Discovery,
this one has **no live trigger to swap at all** - no route in the monolith exposes role-profile
data over HTTP today (confirmed via `grep` across every `src/api/*.routes.ts`), and the only
consumer of `src/matching/roleIntelligence.ts`'s own wrapper functions was
`scripts/seed-intelligence-layer.ts` (which calls `seedRoleProfiles`, the write side - not ported
here). This service exists, is fully tested, and has real endpoints ready for whichever future
caller needs them - the same "built, not yet wired to anything" state most new capabilities in
this codebase start at, just made explicit up front instead of discovered later.

## A real nuance this batch had to get right

`role_profiles` is read by several files that are **not** being extracted this batch and remain
real, live (if background) consumers: `dynamicWeighting.ts`, `careerWeighting.ts`,
`proficiencyWeighting.ts`, `recencyWeighting.ts`, and `careerIntelligence/futureRolePrediction.ts`
all call `db.getAllRoleProfiles()` **directly against the monolith's own database** - none of them
go through `src/matching/roleIntelligence.ts`'s wrapper functions. `proficiencyWeighting.ts`/
`careerWeighting.ts`/`recencyWeighting.ts` in particular are part of the real (if fire-and-forget)
shadow-scoring pipeline that runs on every swipe/recruiter-review decision today - genuinely live,
unlike the confirmed-dormant `dynamicWeighting.ts` scoring path. This means `role_profiles` could
**not** simply become this service's sole property the way `bge_retrieval_shadow_comparisons` did
in Batch 28 - the monolith's own database must keep a fully-populated copy for those real callers.
So this batch follows the Batch 26/27 dual-write pattern (mirror, not full ownership transfer),
not the Batch 28 pattern (full cutover) - the "is this genuinely zero-consumer" check has to be
done fresh for every table, not assumed from the shape of a similar-looking one.

## What this service owns

- **Owns a dual-written, read-only-from-this-service's-own-code mirror**: `role_profiles`. The
  monolith remains the sole writer - `scripts/seed-intelligence-layer.ts`'s unchanged
  `seedRoleProfiles()` call (via `src/matching/roleIntelligence.ts`'s still-intact write-side) is
  the only thing that ever creates or updates a role profile. This service's own
  `upsertRoleProfile`/`patchRoleProfile` in `db.ts` exist only as dual-write's targets.
- **Ported, read-only**: `getRoleProfile`, `getAllRoleProfiles`, `matchRoleByTitle` - byte-identical
  logic. The write-side (`ROLE_SEEDS`, `seedRoleProfiles`, `buildRoleEmbeddingText`) is not ported
  and stays on the monolith.
- **Calls the shared Python BERT embedding service directly** (own copy, same client shape as
  every prior batch).

## No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`

No route in the monolith exposes this data over HTTP today, so there's no user-facing surface to
match and nothing to proxy back to the monolith for - this service's own dual-written mirror is
sufficient for everything it does.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database, and
optionally `MATCHING_ML_SERVICE_URL` (defaults to `http://localhost:8009`) - gracefully degrades
(real `null`, never a fabricated match) when unreachable.

## Architecture references

- Service scope and the dual-write-not-cutover decision: Batch 29 domain audit (this README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6n.
