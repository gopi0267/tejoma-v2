# Matching BGE Shadow Service

Tier 0 microservice (Batch 28 of the Tejoma enterprise architecture series). The fourth extracted
slice of the "Matching" domain - owns the BGE-M3 + BGE-Reranker-v2-m3 retrieval shadow comparison.

## Status

**Current batch (28):** fully implemented and, unlike every other batch in this migration, this
one's real computation trigger has been cut over for real - see "Why this one is different" below.
`bge_retrieval_shadow_comparisons` is written exclusively by this service going forward; the
monolith's own `bgeShadowRetrieval.ts`/`bgeRetrievalClient.ts` remain completely intact and
untouched (strangler-fig discipline - never delete the original), but `swipe.routes.ts` no longer
calls them.

## Why this one is different from every prior batch

Every previous extraction in this migration (Reasoning, Skill Discovery) had to solve for "the
monolith's own computation is real, authoritative, and has downstream consumers - a new service's
independent computation must never silently replace it without careful validation." This module
has neither property:

1. **Zero reporting consumers.** Confirmed via `grep` across `src/` - only `db.ts`/`types.ts`/the
   module itself ever reference `bge_retrieval_shadow_comparisons`. Nothing reads this data today.
2. **The module's own header comment already states it: "SHADOW MODE ONLY - never affects which
   candidates a recruiter sees or their order."** It was never part of any real decision path to
   begin with - not "made" non-authoritative by this extraction, already non-authoritative before
   it.
3. **`swipe.routes.ts`'s own comment confirms the call is fire-and-forget and never touches the
   real response** ("never changes topCandidate/scoredCandidates below").

Given all three, there is no meaningful "shadow-validate the new service against the monolith's
real behavior" step to perform - there's no real behavior for it to diverge from. This service
becomes the sole, real owner of this table from day one; `swipe.routes.ts` now calls it directly
(fire-and-forget, exactly as before) instead of the local module. This is the lowest-risk
extraction in the whole series specifically because of properties 1-3 above, not despite them -
every other remaining piece of `src/matching/` fails at least one of them.

## What this service owns

- **Owns and writes directly**: `bge_retrieval_shadow_comparisons`. No dual-write, no backfill -
  historical rows logged before this batch's cutover stay in the monolith's own (still-existing,
  unread) table; nothing depends on continuity between the two, since nothing ever read this table.
- **Calls the shared Python BGE-M3/BGE-Reranker-v2-m3 service directly** (`src/services/
  bgeRetrievalClient.ts`, its own copy) - never through the monolith, same "return null, never
  throw" contract as the monolith's original.

## No auth, no `MONOLITH_INTERNAL_URL`

This service has no user-facing HTTP surface (same reasoning as matching-reasoning-service) - its
only caller is `swipe.routes.ts`, trusted by network boundary. Unlike every other batch, it also
needs nothing back from the monolith: `swipe.routes.ts` already has the full `Job` and ranked
`Candidate` list in memory at the call site and passes them directly in the request body.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database, and
optionally `BGE_SERVICE_URL` (defaults to `http://localhost:8010`) - gracefully degrades (real
`bgeAvailable: false`, never a fabricated comparison) when unreachable, same as nothing starting
that Python service automatically in local dev today.

## Architecture references

- Service scope and the "why cut over for real" decision: Batch 28 domain audit (this README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6m.
