# Matching Evaluation Service

Tier 0 microservice (Batch 24, extended Batch 25 and Batch 31, of the Tejoma enterprise
architecture series). The first extracted slice of the "Matching" domain - owns ranking
evaluation, Learning-to-Rank training, (Batch 25) shadow-scoring reporting, and (Batch 31) the
ported shadow-weighting cluster (proficiency/career/recency/reasoning signal computation).

## Status

**Current batch (31):** fully implemented, not yet cut over. API Gateway already routes the five
paths from Batch 24/25 (`/api/ml/evaluate[/history]`, `/api/ml/train/ranking`,
`/api/ml/ranking/status`, `/api/proficiency-analytics`, `/api/shadow-data-health`) to it; Batch
31's own `/internal/compute-shadow-weighting` is not gateway-routed (inverse direction - the
monolith calls it, not a browser). The monolith's own `ml.routes.ts`/`evaluation.ts`/
`learningToRank.ts`/`proficiency-analytics.routes.ts`/`shadowDataHealth.ts`/
`proficiencyAnalytics.ts`/`shadowScoring.ts`/`careerWeighting.ts`/`proficiencyWeighting.ts`/
`recencyWeighting.ts`/`reasoningWeighting.ts` are all unchanged and still exist - this is a
parallel, already-routed copy, the same strangler-fig shape every batch since JD Parser Service has
used. "Cut over" here still means the eventual retirement of the monolith's now-dead copies, not
traffic routing (traffic already flows through the Gateway for the Batch 24/25 paths; Batch 31's
shadow-comparison flow is opt-in via `SHADOW_MATCHING_EVALUATION_ENABLED`, off by default).

## Batch 31 - the shadow-weighting cluster

Ports `shadowScoring.ts` (the four-signal orchestrator) and its four signal modules -
`proficiencyWeighting.ts`, `careerWeighting.ts`, `recencyWeighting.ts`, `reasoningWeighting.ts` -
byte-identical logic, unblocked by Batches 26/27 (`skill_nodes`), 29 (`role_profiles`), and 30 (the
`career_trajectories`/`role_profiles` split-shape precedent this batch reuses directly).

**Four passive, read-only dual-write mirrors** (the monolith remains the sole writer of all four):
- `skill_nodes` - THIRD independent mirror target (alongside matching-reasoning-service and
  matching-skill-discovery-service, Batches 26/27), needed by this service's own ported
  `canonicalizeSkill`.
- `role_profiles` - THIRD independent mirror target (alongside role-intelligence-service and
  career-intelligence-service, Batches 29/30), needed by `findLexicalRoleMatch`/`resolveJobRole`.
- `career_trajectories` - this table's FIRST **passive** mirror anywhere in this migration. Unlike
  career-intelligence-service's independently-computed copy (Batch 30, sparse - populated only via
  shadow trigger), this service's ported `careerWeighting.ts` needs the monolith's real, fully
  populated table, so this is a plain upsert-by-id mirror instead.
- `reasoning_conclusions` - this table's FIRST passive mirror too, for the same reason -
  matching-reasoning-service's own copy (Batch 26) is independently computed and sparse; this
  service's ported `reasoningWeighting.ts` needs the complete table. Mirrored via a transactional
  delete+insert per subject (`src/dualWrite.ts`'s `replaceReasoningConclusions`), matching the
  monolith's own `replaceReasoningConclusions` semantics exactly.

**One owned table, written directly by this service's own ported orchestrator**:
`shadow_weighting_computations` - this service's OWN independently-computed version of the same
four-signal chain the monolith's `shadowScoring.ts` computes into `proficiency_shadow_scores`
(already mirrored here since Batch 25, read-only, untouched by this extraction). The two tables
intentionally coexist and are never merged - `proficiency_shadow_scores` is "what the monolith
actually computed" (the passive mirror, ground truth), `shadow_weighting_computations` is "what
this service's own independent computation produced" (for shadow-comparison only), same shape as
`reasoning_conclusions`/`skill_discovery_proposals`/`career_trajectories` in Batches 26/27/30.

**Monolith side**: `src/matchingEvaluationServiceShadow.ts` (new) - drop-in replacement for
`shadowScoring.ts`'s `logShadowScoresInBackground`, gated behind
`SHADOW_MATCHING_EVALUATION_ENABLED` (off by default). `swipe.routes.ts`/
`recruiter-review.routes.ts` now import it instead of the local module.

NUMERIC columns returned by this service's own `insertShadowWeightingComputation` are explicitly
coerced from Postgres's string representation to real JS numbers before being returned over HTTP -
the monolith's shadow-comparison client does a strict JSON-equality diff against real numbers, so
an uncoerced string would make every real comparison spuriously report a divergence.

## Why this batch is scoped this narrowly

A pre-Batch-23 domain audit of `src/matching/` (~40 files) found that essentially none of it could
be safely extracted - almost everything was reachable from at least one hot-path route file, or
from `src/services.ts` (the live scoring engine), which was itself bidirectionally coupled to the
directory. Batch 23 fixed the structural blockers that caused that (see `MIGRATION_RUNBOOK.md`
§6h) but extracted nothing.

Re-auditing after Batch 23, two files stood out as genuinely separable: `evaluation.ts` (zero
`src/matching/` internal imports at all) and `learningToRank.ts` (exactly one - the live scoring
engine's `calculateMatchScoresBatch`, which becomes a clean proxy dependency, the same shape
already used three times elsewhere in this migration). Everything else nominated as a "shadow/
offline" candidate in the original audit - `shadowDataHealth.ts`, `proficiencyAnalytics.ts`,
`bgeShadowRetrieval.ts` - was deferred in Batch 24 based on an assumption (recorded in that batch's
own README) that extracting them would require the monolith to proxy a WRITE out to this service.

**Batch 25 correction**: re-reading `shadowScoring.ts` in full (not trusting Batch 24's own README)
found that assumption was wrong. Its only write, `db.insertProficiencyShadowScore`, is a single
INSERT fired from `swipe.routes.ts`/`recruiter-review.routes.ts` - a normal forward dual-write hook,
the same pattern used everywhere else in this migration, is sufficient. `shadowDataHealth.ts` and
`proficiencyAnalytics.ts` are extracted as of Batch 25 (see below). `bgeShadowRetrieval.ts` remains
deferred - not because of the write-direction problem (it never applied), but because it has zero
reporting-route consumers (confirmed via `grep` across `src/` - only `db.ts`/`types.ts`/its own
writer reference `bge_retrieval_shadow_comparisons`), so there is nothing for a reporting endpoint
to serve yet.

## What this service owns vs. proxies

- **Owns directly, written by this service's own ported logic** (own database, own migration):
  `match_evaluation_runs` and `ltr_model_versions` (Batch 24). Both have a simple, single-writer
  relationship to this service's two source files - nothing else in the monolith writes to either
  table.
- **Owns directly, read-only** (Batch 25): `proficiency_shadow_scores`. Unlike the two tables
  above, this service never writes to it - it's populated entirely by dual-write from the
  monolith's completely unchanged `shadowScoring.ts` (fired on every swipe/recruiter decision).
  `shadowDataHealth.ts` and `proficiencyAnalytics.ts` (both ported, read-only reporting logic) read
  it locally.
- **Proxies to the monolith** (`src/services/monolithClient.ts` → the monolith's
  `/internal/matching-evaluation/*` API): swipe/candidate/job data (for both evaluation and LTR
  training - `swipes`/`candidates`/`jobs` remain monolith-owned), the live scoring engine's
  feature-vector computation (`calculateMatchScoresBatch`, needed only by LTR training), and
  (Batch 25) job titles for `shadowDataHealth.ts`'s seniority inference (`getJobTitles`, batched by
  job id, jobs remain monolith-owned).
- **Calls the Python Learning-to-Rank service directly** (`src/algorithms/ltr-models.ts`, its own
  copy, not a monolith proxy) - exactly as the monolith's own copy of this client always did.
- **A small, deliberate duplication** (Batch 25): `matching/seniorityInference.ts` duplicates the
  ~15-line `inferSeniority` function from the monolith's `careerIntelligence/jobSequence.ts` rather
  than importing that file, which would also pull in `dynamicWeighting.ts` (used by other functions
  in the same file, not by `inferSeniority`) - the same "small utility, own copy per service"
  convention already used for `requestId.middleware.ts`/`logger.ts`/`algorithms/ltr-models.ts`.

## What's deliberately NOT extracted here

`bgeShadowRetrieval.ts`/`bgeRetrievalClient.ts` (zero reporting-route consumers currently - see
above), and the entire remaining `src/matching/` + `services.ts` (skill/role intelligence, career
intelligence, reasoning, the live scoring engine, job/swipe/review/search) all stay on the
monolith. See `MIGRATION_RUNBOOK.md` §6h/§6i/§6j for the fuller picture.

## Auth model

Verifies the same HS256 staff token `src/utils/tokens.ts`'s `signAccessToken` issues today (shared
`JWT_SECRET`), not a JWKS scheme - identical reasoning to `jd-parser-service`/`chat-service`.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database,
`MONOLITH_INTERNAL_URL` for the proxied swipe/candidate/job/scoring data, and optionally
`MATCHING_ML_SERVICE_URL` (defaults to `http://localhost:8009`) for the Python Learning-to-Rank
service - gracefully degrades (real `null`/`false` results, never a fabricated success) when
unreachable, same as the monolith's own copy always did.

## Architecture references

- Service scope and ownership: Batch 24 domain audit + Batch 25 correction (this README's "Why
  this batch is scoped this narrowly") + Batch 31's shadow-weighting cluster (this README's "Batch
  31" section).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6i (Batch 24), §6j (Batch 25), §6p (Batch 31).
