/**
 * Matching Decision Service Client (job-service)
 *
 * Phase 4, Item 5: Calls refresh hook on matching-decision-service
 * when job data changes (create/update/delete).
 *
 * Item 1: getSwipeCountsByJob fan-out for GET /api/jobs (list)
 *
 * Fire-and-forget: never blocks, never throws, timeout at 5 seconds.
 */

import { logger } from '../utils/logger.js';
import { MATCHING_DECISION_SERVICE_URL } from '../config/env.js';

const TIMEOUT_MS = 5000;

interface SwipeCountData {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

type SwipeCountMap = Map<number, SwipeCountData>;

/**
 * Item 1: Get swipe counts grouped by job ID
 * Used by GET /api/jobs (list) to enrich each job with review/acceptance metrics.
 *
 * @param companyId Company ID to scope results
 * @returns Map of job ID to swipe counts, empty map if error
 */
export async function getSwipeCountsByJob(companyId: number): Promise<SwipeCountMap> {
  const result: SwipeCountMap = new Map();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/swipes/counts-by-job?companyId=${companyId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        { status: response.status, companyId },
        'Failed to get swipe counts from matching-decision-service'
      );
      return result; // Return empty map
    }

    const data = (await response.json()) as Record<string, SwipeCountData>;
    for (const [jobId, counts] of Object.entries(data)) {
      result.set(parseInt(jobId, 10), counts);
    }

    return result;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, companyId },
      'Error calling matching-decision-service'
    );
    return result; // Return empty map (graceful degradation)
  }
}

/**
 * Notify matching-decision-service to refresh recruiter_review_view
 * for jobs that changed.
 *
 * @param jobIds Job IDs to refresh
 */
export async function refreshRecruiterReviewViewForJobs(
  jobIds: number[]
): Promise<void> {
  if (!jobIds.length) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/recruiter-review-view/refresh-job`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        { status: response.status, jobIds },
        'Failed to refresh recruiter_review_view for jobs'
      );
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, jobIds },
      'Fire-and-forget refresh call failed'
    );
  }
}
