# Dynamic Weighting / Explainable Matching Service

Tier 0 microservice (Batch 33 of the Tejoma enterprise architecture series). The seventh and last
currently-planned extracted slice of the "Matching" domain - ports the confirmed-dormant Dynamic
Weighting scoring path, its explanation layer, and Hybrid Retrieval.

## Status

**Current batch (33):** fully implemented, not cut over - and like Role Intelligence Service
(Batch 29), there is **no trigger to swap at all**. Every function this service ports is reachable
on the monolith only via `matchingApi.ts`'s `weighting: 'dynamic'` / `retrieval` options, and no
real caller anywhere in this repository ever sets either one (confirmed via
`grep -rln "'dynamic'" src scripts` and `grep -rn "retrieval: {" src` - both return only the files
that *define* the options, never one that sets them). This is the cleanest extraction in the whole
migration: genuinely zero real traffic today, so there is nothing to shadow-validate, nothing to
dual-write-mirror as an owned output, and nothing to backfill beyond the three read-only input
mirrors below.

## A real distinction this batch had to get right

`src/matching/explainability.ts` (**singular** file) and `src/matching/explainability/`
(**plural** folder) are two separate, unrelated things that happen to share a name prefix:

- `explainability.ts` (singular, ported here) - `buildMatchExplanation`, used only inside
  `calculateDynamicMatchScoresBatch` (`services.ts`), the same confirmed-dormant `weighting:
  'dynamic'` path as `dynamicWeighting.ts`'s scoring functions.
- `explainability/` (plural, **NOT** touched by this batch) - `computeExplanation.ts`,
  `concernDetection.ts`, `narrativeGeneration.ts` - genuinely live, reachable from three real route
  files (`candidate-internal.routes.ts`, `candidate-jobs.routes.ts`,
  `recruiter-review.routes.ts`), and `computeExplanation.ts` calls `db.getCareerTrajectory()`
  directly. This stays on the monolith, untouched - conflating the two by name would have
  extracted live, traffic-serving code under the same "safe, zero-risk" umbrella as the genuinely
  dormant trio.

## What this service owns

- **Ported, byte-identical, no owned table**: `resolveSkillTiers`, `computeSeniorityAdjustedWeights`,
  `computeDynamicSkillScore` (`dynamicWeighting.ts`), `buildMatchExplanation`
  (`explainability.ts`, singular), `hybridRetrieveCandidates` and its three retrieval strategies
  (`retrieval.ts`). Every one of these is a pure function over data the caller already has (plus
  this service's own mirrors below) - there is no result row to store, only a computed response.
- **Owns three read-only, dual-written mirrors** (the monolith remains the sole writer of all
  three): `skill_nodes` (FOURTH independent mirror target, alongside matching-reasoning-service,
  matching-skill-discovery-service, and matching-evaluation-service - Batches 26/27/31),
  `skill_edges` (SECOND independent mirror target, alongside matching-reasoning-service - Batch
  26), `role_profiles` (FOURTH independent mirror target, alongside role-intelligence-service,
  career-intelligence-service, and matching-evaluation-service - Batches 29/30/31).

## No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`

Same reasoning as Role Intelligence Service (Batch 29): no route in the monolith exposes these
functions over HTTP today, so there's no user-facing surface to match and nothing to proxy back to
the monolith for. Every `/internal/*` endpoint takes its full input directly in the request body.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database. No
external service dependency.

## Architecture references

- Service scope, the "no trigger to swap" precedent, and the explainability.ts-vs-explainability/
  distinction: Batch 33 domain audit (this README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6q.
