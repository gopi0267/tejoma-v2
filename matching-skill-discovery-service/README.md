# Matching Skill Discovery Service

Tier 0 microservice (Batch 27 of the Tejoma enterprise architecture series). The third extracted
slice of the "Matching" domain - owns Unknown Skill Discovery: detecting, classifying, and
proposing new entries for the shared skill taxonomy from resume/JD text the existing dictionary
can't resolve.

## Status

**Now gateway-routed** (`/api/skills/discovery/*`, added as part of the full-migration effort
reusing this existing service rather than duplicating it - see api-gateway/src/proxy.ts). The
monolith calls this service directly as a shadow-validation comparison for the automatic discovery
pipeline, gated behind `SHADOW_SKILL_DISCOVERY_ENABLED` (default off in local dev). The monolith's
own `unknownSkillDiscovery.ts` and `skill-intelligence.routes.ts` are completely unchanged and
remain the parallel implementation.

## A known, accepted gap at gateway cutover: this service's proposals table starts empty

`skill_discovery_proposals` is not (and cannot be) dual-written or backfilled from the monolith -
classification depends on a non-deterministic LLM call and a live embedding comparison, so there is
no deterministic "primary write" to mirror or replay historically. Practically: until
`SHADOW_SKILL_DISCOVERY_ENABLED=true` is set (see the gateway-cutover batch, which turns this on),
this service's own `pending` list will be empty even though real users can now reach
`/api/skills/discovery/pending` via the Gateway - it will show real proposals only for skills
discovered AFTER the shadow flag is enabled and real candidate/job creation traffic starts flowing
through `discoverUnknownSkillsInBackground` again. This is the same "fresh start, no historical
backfill" trade-off any migration of non-deterministic AI-derived data has to accept - documented
here explicitly rather than silently discovered as a regression.

## What this service owns

- **Owns and writes directly**: `skill_discovery_proposals`, computed by this service's own ported
  detection/classification/embedding/relationship pipeline.
- **Owns a dual-written mirror, read-only from this service's own code**: `skill_nodes` (needed by
  `findNearestNeighbors`/`canonicalizeSkill`). The monolith remains the sole writer - this
  service's `db.ts` `upsertSkillNode`/`patchSkillNode` exist only as dual-write's targets, never
  called by this service's own discovery logic. `skill_edges` is NOT mirrored here -
  `unknownSkillDiscovery.ts` never reads it (only writes new ones during promotion, which proxies
  to the monolith instead - see below).
- **Proxies to the monolith** (`src/services/monolithClient.ts` → the monolith's new
  `/internal/skill-discovery/promote` endpoint): the one write this service never performs itself
  - creating a real `skill_nodes`/`skill_edges` row. The monolith remains the sole writer of the
  skill graph, exactly as Batch 26 established for Matching Reasoning Service.
- **Calls Gemini directly** (own copy of the classification client, `@google/genai`) and **the
  shared Python BERT embedding service directly** (`src/algorithms/bert-embeddings.ts`, its own
  copy) - neither through the monolith, same client shape as every prior batch's own copies.

## A real correctness issue this batch had to resolve, not gloss over

Classification is a non-deterministic LLM call. If the shadow-triggered background pipeline
(fired on every candidate/job creation, mirroring the monolith's real trigger) were allowed to
freely call the promotion proxy whenever ITS OWN independent computation decided to auto-promote,
a shadow-validation comparison could cause a REAL, uncoordinated write to the shared skill graph -
breaking the hard rule every shadow module in this migration follows ("never affects real
behavior"). Fixed with a `skipPromotion` parameter (additive only, not in the monolith's original
signature) threaded through `discoverUnknownSkill`/`discoverUnknownSkills`: the shadow entry point
(`POST /internal/discover`) always passes `skipPromotion: true` - the proposal is still fully
computed and stored in this service's own table (safe, exclusively owned here), but the actual
external promotion call is skipped. The real, human-triggered `POST /api/skills/discovery/:id/approve`
path never sets this flag - an explicit admin approval always promotes for real.

## No `MONOLITH_INTERNAL_URL`-optional here, unlike Reasoning

`MONOLITH_INTERNAL_URL` is required at startup (not graceful-null) - promotion has no safe fallback
without it, since this service never writes the skill graph itself.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database,
`MONOLITH_INTERNAL_URL` for the promotion proxy, and optionally `GEMINI_API_KEY` (gracefully
degrades to queuing every token for manual review when unset, preserving the monolith's own
original behavior exactly - never made required) and `MATCHING_ML_SERVICE_URL` (defaults to
`http://localhost:8009`, gracefully degrades when unreachable).

## Architecture references

- Service scope, ownership, and the gateway-routing decision: Batch 27 domain audit (this
  README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6l.
