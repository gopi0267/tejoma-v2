/**
 * Assembles the Learning-to-Rank training set from the services that own each dataset, replacing
 * monolithClient.getTrainingData() (a single monolith proxy call added when swipes/candidates/jobs
 * were all still monolith-owned - no longer true).
 *
 *   swipes     -> matching-decision-service  GET /internal/swipes/all
 *   candidates -> candidate-core-service     GET /internal/candidates/all
 *   jobs       -> job-service                GET /internal/jobs/all
 *
 * All three are deliberately UNSCOPED: the ranker is trained globally, not per tenant, which is
 * what the monolith's own getAllSwipesUnscoped/getAllCandidatesUnscoped/getAllJobsUnscoped did.
 * The two /all endpoints already existed for exactly this training/reindex use case; only
 * /internal/swipes/all was added, on the service that owns swipes, following that same convention.
 * None of these are Gateway-reachable - proxy.ts 404s /internal/* unconditionally.
 *
 * Fetched in parallel and never throws: an upstream failure yields an empty set, and
 * trainLearningToRank already reports {trained:false, reason} rather than failing the request.
 */
import { MATCHING_DECISION_SERVICE_URL, CANDIDATE_CORE_SERVICE_URL, JOB_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { OpaqueCandidate, Swipe } from '../types.js';

const REQUEST_TIMEOUT_MS = 30000;

async function fetchList<T>(url: string, key: string, label: string): Promise<T[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ status: res.status, label }, 'Training data upstream returned non-ok status');
      return [];
    }
    const body: any = await res.json().catch(() => ({}));
    return (body?.[key] ?? []) as T[];
  } catch (error) {
    logger.warn({ err: (error as Error).message, label }, 'Failed to fetch training data from upstream');
    return [];
  }
}

export async function getTrainingData(): Promise<{ swipes: Swipe[]; candidates: OpaqueCandidate[]; jobs: any[] }> {
  const [swipes, candidates, jobs] = await Promise.all([
    fetchList<Swipe>(`${MATCHING_DECISION_SERVICE_URL}/internal/swipes/all`, 'swipes', 'swipes'),
    fetchList<OpaqueCandidate>(`${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/all`, 'candidates', 'candidates'),
    fetchList<any>(`${JOB_SERVICE_URL}/internal/jobs/all`, 'jobs', 'jobs'),
  ]);

  logger.info(
    { swipes: swipes.length, candidates: candidates.length, jobs: jobs.length },
    'Assembled Learning-to-Rank training data from owning services'
  );

  return { swipes, candidates, jobs };
}
