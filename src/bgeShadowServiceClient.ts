/**
 * Client for Matching BGE Shadow Service (Batch 28) - a genuine cutover, not a shadow-validation
 * wrapper like every other Batch 26/27 client in this migration. See
 * matching-bge-shadow-service/README.md's "Why this one is different" for the full reasoning:
 * bge_retrieval_shadow_comparisons has zero reporting consumers and was already a pure,
 * non-authoritative shadow signal before this extraction (its own module doc already said
 * "SHADOW MODE ONLY - never affects which candidates a recruiter sees or their order") - there is
 * no real monolith behavior to preserve-and-compare-against here, so this service becomes the
 * sole, real owner of this table from day one.
 *
 * Drop-in replacement for matching/bgeShadowRetrieval.ts's own exported
 * logBgeShadowComparisonInBackground - same name, same signature, same fire-and-forget contract
 * ("never changes topCandidate/scoredCandidates", per swipe.routes.ts's own comment at the call
 * site) - the monolith's own bgeShadowRetrieval.ts/bgeRetrievalClient.ts remain completely
 * unchanged and intact (strangler-fig discipline - never delete the original), simply no longer
 * called.
 *
 * HARD RULES:
 *   1. Never throws - a network/timeout failure here must never affect the real swipe-queue
 *      response, exactly as the original's own contract already guaranteed.
 *   2. No SHADOW_*_ENABLED flag, unlike every other client in this migration - there is nothing to
 *      gate, since this call was already side-effect-only with zero consumers before this batch.
 *      If MATCHING_BGE_SHADOW_SERVICE_URL is unset, this silently no-ops (equivalent to the
 *      original's own "silently no-ops if the BGE service isn't running" default state).
 */
import { logger } from './utils/logger.js';
import type { Candidate, Job } from './types.js';

const MATCHING_BGE_SHADOW_SERVICE_URL = process.env.MATCHING_BGE_SHADOW_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 90000; // real BGE-M3 embed + rerank passes on CPU can take well over a minute - see bgeShadowRetrieval.ts's own benchmark comment

async function postCompare(companyId: number, job: Job, existingRanked: Array<{ candidate: Candidate; match_score: number }>): Promise<void> {
  if (!MATCHING_BGE_SHADOW_SERVICE_URL) {
    logger.debug('MATCHING_BGE_SHADOW_SERVICE_URL is not set - BGE shadow comparison skipped for this request.');
    return;
  }

  try {
    const response = await fetch(`${MATCHING_BGE_SHADOW_SERVICE_URL}/internal/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, job, existingRanked }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ status: response.status, jobId: job.id }, 'matching-bge-shadow-service returned a non-OK status');
    }
  } catch (error: any) {
    logger.debug({ err: error?.message, jobId: job.id }, 'matching-bge-shadow-service unavailable - comparison skipped for this request');
  }
}

/** Drop-in replacement for matching/bgeShadowRetrieval.ts's own logBgeShadowComparisonInBackground. */
export function logBgeShadowComparisonInBackground(companyId: number, job: Job, existingRanked: Array<{ candidate: Candidate; match_score: number }>): void {
  postCompare(companyId, job, existingRanked).catch((err) => logger.warn({ err: err?.message }, 'BGE shadow retrieval comparison failed'));
}
