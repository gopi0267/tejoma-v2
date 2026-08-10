# Matching Reasoning Service

Tier 0 microservice (Batch 26 of the Tejoma enterprise architecture series). The second extracted
slice of the "Matching" domain - owns the AI Reasoning Layer (semantic/concept/hierarchical/
causal/technology-relationship inference over a candidate's or job's skills).

## Status

**Current batch (26):** fully implemented, not cut over. Unlike every other Tier 0 service, this
one is not gateway-routed at all - see "Why the cutover mechanism is different" below. The
monolith calls this service directly (never through API Gateway) as a shadow-validation
comparison, gated behind `SHADOW_REASONING_ENABLED` (default off). The monolith's own
`computeReasoning.ts` and its five reasoning modules are completely unchanged and remain the sole
producer of real `reasoning_conclusions` rows read by production code (`explainability/
computeExplanation.ts`).

## Why the cutover mechanism is different here

Every prior Tier 0 service extraction had a genuine, separately-routable HTTP endpoint to hand off
to API Gateway (`POST /api/ml/evaluate`, `GET /api/shadow-data-health`, etc.) - cutover meant
adding a gateway `ROUTES` entry. The AI Reasoning Layer has no such endpoint: it is triggered as a
fire-and-forget side effect of `POST /api/candidates` / `POST /api/jobs` (staying on the
monolith), not by its own route.

The chosen shape (confirmed with the user before implementation): the monolith becomes an HTTP
*client* of this service - the same relationship it already has with `python-services/
matching-ml-service`, just for a Tier 0 TypeScript service instead. Concretely:
`src/reasoningServiceShadow.ts` (monolith) wraps the unchanged `computeReasoningForCandidate`/
`computeReasoningForJob`, and - only when `SHADOW_REASONING_ENABLED=true` - also POSTs the same
inputs to this service's `/internal/compute-for-candidate`/`/internal/compute-for-job` and diffs
the two results. This mirrors the exact shape of every other shadow-validation module in this
migration (`jdParserShadow.ts`, `candidateShadow.ts`) - disabled by default, never affects the
real response, logs divergence at `error`.

## What this service owns

- **Owns and writes directly**: `reasoning_conclusions`, computed by this service's own ported
  `computeReasoningForCandidate`/`computeReasoningForJob` when the monolith's shadow caller invokes
  `/internal/compute-for-candidate`/`/internal/compute-for-job`.
- **Owns a dual-written mirror, read-only from this service's own code**: `skill_nodes`/
  `skill_edges`. The monolith remains the sole writer (`skillIntelligence.ts`'s seeding,
  `unknownSkillDiscovery.ts`'s promotion pipeline) - this service's `db.ts` has
  `upsertSkillNode`/`upsertSkillEdge`/`patchSkillNode` only because they are dual-write's targets,
  never called by this service's own reasoning logic.
- **Calls the shared Python BERT embedding service directly** (`src/algorithms/
  bert-embeddings.ts`, its own copy) - for `semanticReasoning.ts`'s embedding-neighbor tier, never
  through the monolith, same as `matching-evaluation-service`'s copy of this client.

## What's ported vs. duplicated vs. not touched

- **Ported byte-identical**: all six reasoning modules (`matching/reasoning/*.ts`).
- **Ported, narrowed**: `matching/projectIntelligence.ts` - `analyzeProject`/`analyzeProjectEntries`
  only (the read-only slice `causalReasoning.ts` needs); the monolith's
  `computeAndStoreProjectIntelligence` (writes `candidates.project_intelligence`) is a separate,
  unrelated concern, not ported.
- **Duplicated, trivial**: `matching/skillLookup.ts` (`canonicalizeSkill`/`canonicalizeSkills`,
  2-line wrappers around `db.findSkillNodeByAlias`) and `utils/vectorMath.ts`
  (`cosineSimilarity`, a pure function) - both avoid pulling in their monolith source files'
  unrelated write-side logic (`skillIntelligence.ts`'s seeding, `utils/embeddings.ts`'s Gemini
  client), the same "small utility, own copy per service" convention used throughout this
  migration.
- **Not touched**: everything else in `src/matching/` (skill/role intelligence, career
  intelligence, dynamic weighting, the live scoring engine, evaluation/LTR - already on
  `matching-evaluation-service`) stays on the monolith.

## No user-facing HTTP surface

This service has no auth middleware and is not in API Gateway's `ROUTES` table - its only caller
is the monolith itself, trusted by network boundary (the same trust model every other `/internal/*`
endpoint in this migration uses, direction reversed). `GET /health`/`/live`/`/ready` and
`GET /metrics` are the only other endpoints, for infra/observability.

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database, and
optionally `MATCHING_ML_SERVICE_URL` (defaults to `http://localhost:8009`) for the Python BERT
embedding service - gracefully degrades (real `null`, never a fabricated embedding) when
unreachable.

## Architecture references

- Service scope, ownership, and the cutover-mechanism decision: Batch 26 domain audit (this
  README).
- Migration methodology: `MIGRATION_RUNBOOK.md` §6k.
