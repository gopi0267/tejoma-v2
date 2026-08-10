/**
 * HTTP client for matching-scoring-service's /internal/rank-candidates-for-job (Remaining-monolith
 * migration, Step 5) - candidate-search.routes.ts's own query-vs-candidates ranking, tier:
 * 'heuristic' (the exact computeMatchFeatures/computeFeatureScore-only pipeline this route has
 * always used, ported to matching-scoring-service in Step 2 - see that service's src/matching/
 * matchingApi.ts module doc for why 'heuristic' never touches the ML ensemble/embeddings/
 * persistence). Job and candidates here are synthetic objects (toSyntheticJobFromQuery/
 * toSyntheticCandidateFromAccount, built locally in candidateSearch.routes.ts - not this
 * client's concern), never real `jobs`/`candidates` rows, so `persist` is never passed.
 */
import { MATCHING_SCORING_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';
import type { Job, Candidate, RankedCandidate } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000;

export class MatchingScoringServiceError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`matching-scoring-service returned ${status}`);
  }
}

export async function rankCandidatesForJob(job: Job, candidates: Candidate[]): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MATCHING_SCORING_SERVICE_URL}/internal/rank-candidates-for-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, candidates, tier: 'heuristic' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target: 'rank-candidates-for-job', outcome: 'error' });
      throw new MatchingScoringServiceError(res.status, body);
    }
    upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target: 'rank-candidates-for-job', outcome: 'success' });
    return body.ranked ?? [];
  } catch (error) {
    if (!(error instanceof MatchingScoringServiceError)) {
      upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target: 'rank-candidates-for-job', outcome: 'error' });
      logger.error({ err: (error as Error).message }, 'matching-scoring-service rank-candidates-for-job call failed');
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'matching-scoring-service', target: 'rank-candidates-for-job' }, durationSeconds);
  }
}
