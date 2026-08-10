/**
 * HTTP client for the monolith's /internal/matching-evaluation/* API
 * (src/api/matching-evaluation-internal.routes.ts, Batch 24) - swipe/candidate/job data (for
 * evaluation and LTR training) and the live scoring engine's feature-vector computation
 * (calculateMatchScoresBatch, for LTR training) all remain the monolith's - see config/env.ts's
 * header comment. Every function here is a direct pass-through: same query params, same response
 * shape as the target endpoint - this module's only job is the network call and basic
 * latency/outcome metrics, never re-deriving or reshaping what the monolith already computed.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';
import type { Swipe, OpaqueCandidate, OpaqueJob } from '../types.js';
import type { MatchScoreResult } from './scoringTypes.js';

const REQUEST_TIMEOUT_MS = 30000; // score-batch/training-data can be slow with a large real dataset

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/matching-evaluation${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    monolithProxyCount.inc({ target, outcome: 'success' });
    return body as T;
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
      // Raw network/timeout failures must also surface as MonolithProxyError - see
      // recruiting-service's monolithClient.ts (Batch 19) for the exact bug this avoids.
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

/** Every swipe for a single company, action IS NOT NULL - the real dataset ranking evaluation grades. */
export function getSwipesForEvaluation(companyId: number): Promise<{ swipes: Swipe[] }> {
  return call('swipes-for-evaluation', `/swipes-for-evaluation?companyId=${companyId}`);
}

/** Pooled-across-every-company swipes/candidates/jobs - the real dataset LTR training pools from. */
export function getTrainingData(): Promise<{ swipes: Swipe[]; candidates: OpaqueCandidate[]; jobs: OpaqueJob[] }> {
  return call('training-data', '/training-data');
}

/** Wraps the monolith's own calculateMatchScoresBatch (services.ts) - the live scoring engine this service doesn't own. */
export function scoreBatch(job: OpaqueJob, candidates: OpaqueCandidate[], options?: { skipGeminiSummary?: boolean }): Promise<{ results: MatchScoreResult[] }> {
  return call('score-batch', '/score-batch', {
    method: 'POST',
    body: JSON.stringify({ job, candidates, options }),
  });
}

/**
 * Batch 25 - job titles for a specific set of job IDs, company-scoped (jobs remain
 * monolith-owned). shadowDataHealth.ts needs only `.title` per job to infer seniority - a
 * thin wrapper around the monolith's existing db.getJobById, batched into one internal API call.
 */
export function getJobTitles(companyId: number, jobIds: number[]): Promise<{ jobs: { id: number; title: string }[] }> {
  if (jobIds.length === 0) return Promise.resolve({ jobs: [] });
  return call('job-titles', `/job-titles?companyId=${companyId}&jobIds=${jobIds.join(',')}`);
}
