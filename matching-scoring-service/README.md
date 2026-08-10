# Matching Scoring Service

Tier 0 microservice (full-migration continuation). Owns the shadow-validation extraction of the
**live-scoring engine** - `computeMatchFeatures`, `calculateMatchScoresBatch`,
`calculateMatchScoresForJobsBatch` - the single piece of the monolith explicitly held back from
every prior extraction batch as "the highest-blast-radius part of the whole system."

## Status: shadow-validation only, not cut over

The monolith's own `src/matching/services.ts` is **completely unchanged** and remains the sole
producer of every real `match_score`/`detailed_scoring_report` a recruiter or candidate ever sees.
This service computes the exact same math independently, on the exact same inputs, and the
monolith diffs the two results after every real request - it never affects a real response.
Gated behind `SHADOW_SCORING_ENABLED` (default off, same convention as `SHADOW_REASONING_ENABLED`/
`SHADOW_SKILL_DISCOVERY_ENABLED`).

**This is deliberate, not a half-finished cutover.** A pricing/ranking/scoring engine is the one
class of computation that real production systems never cut over on faith - shadow validation over
real traffic, then a real cutover decision, is the correct sequence, not a shortcut. Nothing about
recruiter-visible or candidate-visible behavior changes until that second step happens, and that
second step is intentionally not part of this batch.

## Why the cutover mechanism mirrors matching-reasoning-service, not matching-bge-shadow-service

Two prior shadow-only services exist in this migration and they made opposite calls for a reason:

- **matching-bge-shadow-service** (`bge_retrieval_shadow_comparisons`) had **zero real reporting
  consumers** before its own extraction - a pure diagnostic side-channel already. It became the
  sole, real owner of its table from day one; no comparison-with-the-original needed because there
  was no "original" with real consumers to protect.
- **This service** is the opposite case: `calculateMatchScoresBatch`'s output **is** what a
  recruiter's "Match Candidates" queue and a candidate's job-discovery feed actually show. There is
  a real, live, authoritative computation to preserve - so this follows
  **matching-reasoning-service's** shape instead: the monolith stays the sole source of truth,
  this service computes independently and stores its own historical record, and the actual
  agree/diverge comparison + logging happens on the monolith side
  (`src/matchingScoringServiceShadow.ts`), never here.

## What this service owns

- **Owns and writes directly**: `scoring_computations` - one row per shadow-comparison call,
  storing this service's own independently-computed `MatchScoreResult[]` for `job_id` +
  `request_kind` (`candidates_batch` | `jobs_batch`) + `model_type`.
- **No dual-write, no mirror of any monolith table.** Every input the ported pipeline needs (the
  full `Job` object, `Candidate[]`/`Job[]`, and the monolith's own current `activeModelType`) is
  passed directly in the request body - the monolith already has all of it in memory at the exact
  point it calls this service, identical to how `matching-bge-shadow-service`/
  `matching-reasoning-service` receive their inputs.

## Ported vs. deliberately not ported

Ported (byte-identical formulas to the monolith's `src/matching/services.ts`, only reorganized -
see `src/matching/services.ts`'s own header comment for the one real deviation, `modelType`
threaded as a parameter instead of a shared mutable module `let`, to avoid a request-concurrency
race that doesn't exist in the monolith's admin-toggle-driven original):

- `computeMatchFeatures` (Jaccard/cosine/Euclidean/Levenshtein/location/salary sub-scores)
- `computeBertCosineScore` / `buildFeatureVector` / `computeFeatureScore`
- `calculateMatchScoresBatch` (rank N candidates for one job)
- `calculateMatchScoresForJobsBatch` (rank N jobs for one candidate)
- Its full pure-computation dependency chain: `algorithms/{jaccard,cosine,euclidean,levenshtein,
  ml-models}.ts`, `matching/similarity/locationDistance.ts`, `matching/parseCandidateFields.ts`,
  and the small slice of `jd-parser/{types,matcher/trie,dictionaries/locations.dictionary,
  tiers/regexTier}.ts` those two depend on (copied verbatim from `jd-parser-service`, which already
  owns the real extraction of that code).

Deliberately **not** ported:

- **Gemini summary generation.** `summary` is never a scoring-correctness signal the shadow
  comparison cares about, and calling Gemini a second time per real request would double live API
  cost/quota for zero benefit. This service always returns `summary: ''`.
- **`calculateDynamicMatchScoresBatch`.** The monolith's own module doc states this path is "NOT
  called by any existing surface by default" (opt-in only, zero live traffic today) and it needs
  `role_profiles` + `skill_nodes`/`skill_edges` graph reads (`dynamicWeighting.ts`) that would
  require this service to reach into two other services' data for a path nothing calls yet. Out of
  scope until that path has a real caller.
- **`trainModelOnStartup`.** A batch job, not the scoring hot path - training stays in the monolith
  (reads `db.getAllSwipesUnscoped`/`getAllCandidatesUnscoped`/`getAllJobsUnscoped` directly).

## Endpoints

- `POST /internal/score/candidates-batch` - `{ job, candidates[], modelType? }` → `{ results }`
- `POST /internal/score/jobs-batch` - `{ candidate, jobs[], modelType? }` → `{ results }`
- `GET /health`, `/live`, `/ready`, `/metrics` - standard Tier 0 conventions.

## Not gateway-routed

Same reasoning as `matching-reasoning-service`/`matching-bge-shadow-service`: this service has no
user-facing HTTP surface at all. Its only caller is the monolith's own shadow client, over the
internal Docker network, never through API Gateway.
