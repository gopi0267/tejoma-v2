# Chat Service

Tier 0 microservice (Batch 17 of the Tejoma enterprise architecture series). Owns the RAG
chatbot's knowledge base and the recruiter-facing `/api/chat` and `/api/chat/reindex` endpoints.

## Status

**Current batch (17):** fully implemented, not yet cut over. Real traffic still goes to the
monolith directly; API Gateway is not yet the production entry point.

## What this service owns vs. proxies

- **Owns directly** (own database, own migration): `knowledge_base_chunks` - the searchable
  knowledge base the chatbot retrieves from. Mirrored in real time from the monolith via
  `dualWrite.ts` once `DUAL_WRITE_ENABLED=true`.
- **Proxies to the monolith** (`src/services/monolithClient.ts` → the monolith's new
  `/internal/chat/*` API): candidate/job counts (for the "PLATFORM STATS" the chat prompt cites as
  authoritative) and unscoped candidate/job lists (for the admin reindex endpoint). These
  genuinely still belong to the monolith's Recruiting/Matching domain (Batch 17 domain audit).

## Why this isn't fully self-contained

Unlike JD Parser Service, this domain has real, direct dependencies on Recruiting data:
`POST /chat` needs an accurate company-wide candidate/job count (not just what's in the
retrieved-chunk sample) so the AI doesn't hallucinate totals, and `POST /chat/reindex` needs the
same cross-tenant-unscoped candidate/job reads the Matching domain's ML training already uses
(`getAllCandidatesUnscoped`/`getAllJobsUnscoped`) - a deliberate, pre-existing exception to normal
company scoping, preserved here rather than "fixed."

## A note on shadow-validation for this service

Chat replies are LLM-generated text (temperature 0.3) - two independent calls with an identical
prompt will not produce byte-identical wording, even when both are working correctly. Comparing
`reply` strictly would report false-positive divergence on every single request. `src/chatShadow.ts`
(monolith) therefore compares only the deterministic parts: HTTP status and the `sources` array
(which knowledge-base chunks were retrieved, by id/type/score) - not the generated prose.

## Auth model

Verifies the same HS256 staff token `src/utils/tokens.ts`'s `signAccessToken` issues today (shared
`JWT_SECRET`), not a JWKS scheme - identical reasoning to `jd-parser-service` (Batch 15).

## Local development

```
npm install
npm run migrate
npm run dev
```

Requires `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` for this service's own database,
`MONOLITH_INTERNAL_URL` for the proxied stats/reindex data, and a real `GEMINI_API_KEY` (required,
not optional - this service's entire purpose is generating and embedding text via Gemini).

## Architecture references

- Service scope and ownership: Batch 17 domain audit.
- Migration methodology: `MIGRATION_RUNBOOK.md`.
