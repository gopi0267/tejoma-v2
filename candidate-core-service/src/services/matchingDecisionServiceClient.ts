/**
 * Matching Decision Service Client (candidate-core-service)
 *
 * Phase 4, Item 5: Calls refresh hook on matching-decision-service
 * when candidate data changes (create/update/delete).
 *
 * Fire-and-forget: never blocks, never throws, timeout at 5 seconds.
 */

import { logger } from '../utils/logger.js';
import { MATCHING_DECISION_SERVICE_URL } from '../config/env.js';

const TIMEOUT_MS = 5000;

/**
 * Notify matching-decision-service to refresh recruiter_review_view
 * for candidates that changed.
 *
 * @param candidateIds Candidate IDs to refresh
 */
export async function refreshRecruiterReviewViewForCandidates(
  candidateIds: number[]
): Promise<void> {
  if (!candidateIds.length) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/recruiter-review-view/refresh-candidate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        { status: response.status, candidateIds },
        'Failed to refresh recruiter_review_view for candidates'
      );
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, candidateIds },
      'Fire-and-forget refresh call failed'
    );
  }
}
