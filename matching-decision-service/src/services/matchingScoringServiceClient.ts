/**
 * HTTP client for matching-scoring-service's /internal/rank-candidates-for-job and
 * /internal/score-candidate-for-job (Remaining-monolith migration, Step 6) - the same tier:
 * 'full' pipeline swipe.routes.ts always called directly (Enterprise AI Matching Architecture,
 * Phase 0), now reached over HTTP instead of an in-process import.
 */
import { MATCHING_SCORING_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';
import type { Job, Candidate, RankedCandidate, MatchScoreResult } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000;

export class MatchingScoringServiceError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`matching-scoring-service returned ${status}`);
  }
}

async function post<T>(target: string, path: string, body: unknown): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MATCHING_SCORING_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseBody: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target, outcome: 'error' });
      throw new MatchingScoringServiceError(res.status, responseBody);
    }
    upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target, outcome: 'success' });
    return responseBody as T;
  } catch (error) {
    if (!(error instanceof MatchingScoringServiceError)) {
      upstreamProxyCount.inc({ upstream: 'matching-scoring-service', target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'matching-scoring-service call failed');
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'matching-scoring-service', target }, durationSeconds);
  }
}

export async function rankCandidatesForJob(
  job: Job,
  candidates: Candidate[],
  options: { skipGeminiSummary?: boolean; persist?: { companyId: number; source?: string } }
): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];
  const body = await post<{ ranked: RankedCandidate[] }>('rank-candidates-for-job', '/internal/rank-candidates-for-job', {
    job, candidates, tier: 'full', skipGeminiSummary: options.skipGeminiSummary, persist: options.persist,
  });
  return body.ranked ?? [];
}

// No skipGeminiSummary here - matching-scoring-service's own /internal/score-candidate-for-job
// doesn't accept it (only job/candidate/modelType), and POST /api/matches/score's own monolith
// original never passed it either (unlike POST /swipes, which stays proxied - see
// matches.routes.ts's header comment).
export async function scoreCandidateForJob(job: Job, candidate: Candidate): Promise<MatchScoreResult> {
  const body = await post<{ score: MatchScoreResult }>('score-candidate-for-job', '/internal/score-candidate-for-job', { job, candidate });
  return body.score;
}
