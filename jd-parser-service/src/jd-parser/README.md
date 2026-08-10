# JD (Job Description) Parser

Production hybrid pipeline: Regex -> Dictionary (Aho-Corasick-style trie) -> spaCy -> PhraseMatcher -> GLiNER -> Zod validation. Free/open-source only. No LLM fallback is wired in (Tiers 1-2 resolve the large majority of well-formed JDs on their own; Tier 3-5 exists specifically so an LLM fallback isn't needed for the fields that would otherwise require one).

## Architecture

```
src/jd-parser/
  pipeline.ts              orchestrator: runs all tiers, merges, validates
  schema.ts                Zod schema + validateAndNormalize()
  types.ts                 ParsedJobDescription + provenance types
  matcher/trie.ts           hand-rolled multi-pattern dictionary matcher
  dictionaries/*.ts         skills/education/certifications/languages/locations
  tiers/regexTier.ts        experience, salary, notice period, openings, employment type, remote/hybrid/onsite
  tiers/dictionaryTier.ts   skills (required/optional split), education, certs, languages, location
  tiers/structuralTier.ts   job title / summary / responsibilities heuristics (still Tier 1, no NLP)
  tiers/nlpTier.ts          HTTP client to the Python microservice (resilient - never blocks a parse)

python-services/jd-nlp-service/
  main.py, matchers.py, ner.py    spaCy + PhraseMatcher + GLiNER, persistent FastAPI service
```

**Why two services.** spaCy/PhraseMatcher/GLiNER are Python-only - there is no Node equivalent. This repo already had a Python 3.14 venv with spaCy 3.8.13, GLiNER 0.2.27, transformers, and torch installed (from an earlier, never-wired-in experiment, `extract_resume_features.py`, which reloaded every model from disk on every call). Reloading GLiNER/spaCy per request takes several seconds - incompatible with a <300ms target - so this pipeline instead runs the Python side as a **persistent FastAPI service** (`python-services/jd-nlp-service`) that loads both models once at startup and serves requests with warm models. Node calls it over local HTTP (`JD_NLP_SERVICE_URL`, default `http://localhost:8008`) and only for the specific fields Tiers 1-2 couldn't resolve.

**Deployment implication:** running this in production means running two long-lived processes (the Node server and `uvicorn main:app`), not one. If that's not acceptable for your hosting target, `nlpTier.ts` degrades gracefully (returns empty fields, never throws) when the Python service is unreachable - `jobTitle`/`location`/`responsibilities`/`jobSummary` all have working non-NLP fallbacks in `structuralTier.ts`/`dictionaryTier.ts`; only `industry`/`department` would come back `null` without the Python service running.

## Field -> tier mapping

| Tier | Fields |
|---|---|
| Regex (Node) | minimumExperience, maximumExperience, experienceUnit, salaryMinimum/Maximum/Currency, noticePeriod, numberOfOpenings, employmentType, remoteType |
| Structural heuristics (Node, still Tier 1) | jobTitle (label or first-line), jobSummary (summary section or first 2 sentences), responsibilities (bullet list under a Responsibilities-type header) |
| Dictionary trie (Node) | requiredSkills/optionalSkills (section-aware), requiredTools/Technologies/Frameworks/Databases/CloudPlatforms/Methodologies (category-routed from requiredSkills), education, certifications, requiredLanguages, location |
| spaCy (Python) | location NER fallback (GPE/LOC), responsibilities fallback (POS-tag sentence classification), jobSummary fallback (sentence segmentation) |
| PhraseMatcher (Python) | jobTitle, tried before GLiNER |
| GLiNER (Python) | industry, department, jobTitle fallback if PhraseMatcher found nothing |
| Zod (Node) | final validation on the merged result - every field nullable/empty by default, cross-field refinements (min<=max), rejects malformed output before it reaches the database |

## Benchmark results (`npx tsx benchmark/jd-parser-benchmark.ts [--with-nlp]`, 5 fixtures x 20 runs each)

| Mode | Avg | P50 | P95 | Max |
|---|---|---|---|---|
| Tier 1-2 only (regex + dictionary) | **0.41ms** | 0.28ms | 0.89ms | 4.67ms |
| Full pipeline incl. Python NLP tier | **178ms** | 172ms | 244ms | 267ms |

Both meet the <300ms target. In practice, most well-formed JDs (clear section headers, explicit company/team names) resolve `industry`/`department` from GLiNER on every call today, since those two fields have no Tier 1-2 fallback - that's the entire cost of the "full pipeline" number above. The Tier-1-2-only path is effectively free.

## Performance recommendations (for future work)

1. **industry/department are the only fields that always hit the Python tier.** If p95 latency ever becomes a problem at higher volume, the cheapest fix is making these two fields optional/on-demand (e.g. a "Full Analysis" toggle in the UI) rather than always-on, since every other field already has a fast, non-NLP path.
2. **ONNX-export the GLiNER model** (`urchade/gliner_small-v2`) and serve via `onnxruntime` instead of raw PyTorch - typically a 2-4x CPU inference speedup with no accuracy loss, and removes the `torch` runtime dependency from the served path.
3. **Batch concurrent requests** at the FastAPI layer (a short request-coalescing window) if JD parsing volume ever becomes bursty - GLiNER inference on a batch of N texts is much cheaper per-item than N separate calls.
4. **Run multiple uvicorn workers** (`--workers N`) behind a process manager once real concurrent load appears - the current single-worker setup is fine for a single recruiter pasting one JD at a time, not for high-concurrency production traffic.
5. **GPU inference**, if ever available in the deployment environment, would cut GLiNER latency further, though it's not required to hit the current <300ms target on CPU.

## Known accuracy limitations (documented, not silently hidden)

- Single common-word skill aliases (e.g. "Go" for Golang) can theoretically false-positive inside ordinary sentences ("go through the process") - the word-boundary check in `matcher/trie.ts` prevents substring false positives (won't match "Go" inside "Google") but can't disambiguate a real word used in its ordinary English sense. Genuinely single/double-letter language names (R, C) were deliberately excluded from the dictionary for this reason.
- The `responsibilities` POS-tag fallback (used only when a JD has no recognizable "Responsibilities:" section) catches imperative-mood sentences ("Design and build...") but misses sentences phrased with a subject ("You will design..."). The primary bullet-list extraction path (`structuralTier.ts`) doesn't have this limitation - it only applies to unstructured prose fallback.
- GLiNER's `industry`/`department` extraction is zero-shot and occasionally returns an adjacent word (a generic-trailing-word stripper in `ner.py` mitigates the most common pattern, e.g. echoing the label word itself, but isn't exhaustive).
