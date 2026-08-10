# Career Intelligence Service

Tier 0 microservice (Batch 30 of the Tejoma enterprise architecture series). The sixth extracted
slice of the "Matching" domain - owns `career_trajectories`: job-sequence normalization,
progression/transition analysis, stability/domain analysis, trajectory embedding, and rule-based
future-role prediction, computed from a candidate's `work_history`.

## Status

**Current batch (30):** fully implemented, not cut over. Triggered by the monolith as a
shadow-validation call (`SHADOW_CAREER_INTELLIGENCE_ENABLED`, default off) alongside the
monolith's own unchanged computation - not yet the production source of truth for
`career_trajectories`.

## Two ownership shapes in one service - the real nuance this batch had to get right

Unlike every prior batch, this service owns two tables with **different** cutover shapes, because
the "check every table's real consumers first" audit (established in Batch 29, repeated here per
`MIGRATION_RUNBOOK.md` §6n's own note) came back differently for each:

- **`career_trajectories` (this service's own output table): independent computation, shadow-
  validated - same shape as Batch 26 (Reasoning) and Batch 27 (Skill Discovery).** The monolith's
  own `career_trajectories` table has real, live (if fire-and-forget) readers still on the
  monolith - `careerWeighting.ts` (part of the real shadow-scoring pipeline that runs on every
  swipe/recruiter-review decision) and `explainability/computeExplanation.ts` (the real recruiter-
  review explanation endpoint) both call `db.getCareerTrajectory()` directly. Mirroring the
  monolith's version into this service would conflict with this service's own independently-
  computed version of the same row - the same conflict class already reasoned through in Batches
  26/27. So this service's copy is NOT a mirror: it's populated only when the monolith's shadow-
  validation client triggers this service, and the monolith's own table (and its two real readers)
  are completely unaffected either way.
- **`role_profiles` (an input dependency): dual-write mirror - same shape as Batch 29 (Role
  Intelligence).** `normalizeJobSequence`/`resolveJobRole` (via `findLexicalRoleMatch`) and
  `predictNextRoles` both need to resolve a free-text title against real role-profile data. This is
  the THIRD independent mirror of `role_profiles` in this migration (alongside Role Intelligence
  Service's own from Batch 29, and the underlying dual-write fan-out pattern already established
  for `skill_nodes` across Batches 26/27) - each service owns its own fully isolated copy, per the
  project's explicit "no shared database" requirement. The monolith remains the sole writer.

## What this service owns

- **Owned, written directly by this service's own pipeline**: `career_trajectories`. Ported,
  byte-identical logic: `jobSequence.ts` (seniority inference, duration/domain resolution),
  `progression.ts` (transition classification, progression type, seniority trend),
  `stability.ts` (tenure stats, employment gaps, domain breakdown - **fairness-critical**: reports
  facts only, never an interpretation or penalty, per the architecture doc's own governance
  requirement), `trajectoryEmbedding.ts` (deterministic recency-weighted 16-dim vector, its own
  embedding space), `futureRolePrediction.ts` (rule-based from Role Intelligence's seed data),
  `computeCareerTrajectory.ts` (the Module 1-5 orchestrator, plus `querySimilarTrajectories`'
  in-memory cosine comparison).
- **Owns a dual-written, read-only-from-this-service's-own-code mirror**: `role_profiles`. The
  monolith remains the sole writer - `upsertRoleProfile`/`patchRoleProfile` in `db.ts` exist only
  as dual-write's targets, never called by this service's own read-only logic.

## No auth, no gateway routing, no `MONOLITH_INTERNAL_URL`

This service has no user-facing HTTP surface at all - its only caller is the monolith's own
`candidate.routes.ts` (via `src/careerIntelligenceServiceShadow.ts`), fire-and-forget, trusted by
network boundary. It needs nothing back from the monolith at request time:
`candidate.routes.ts` already has the full `work_history` in memory and passes it directly in the
request body; `role_profiles` is satisfied entirely by this service's own dual-written mirror.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database. No
other external dependency - unlike Role/Reasoning services, this pipeline calls no embedding
service at request time (the trajectory embedding is a deterministic hand-computed vector, not a
call to the shared BERT service).

## Architecture references

- Service scope and the split dual-shape decision: Batch 30 domain audit (this README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6o.
