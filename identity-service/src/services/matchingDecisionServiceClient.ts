/**
 * Matching Decision Service Client (identity-service)
 *
 * Phase 4, Item 5: Calls refresh hook on matching-decision-service
 * when recruiter data changes (name/email/status).
 *
 * Fire-and-forget: never blocks, never throws, timeout at 5 seconds.
 */

import { logger } from '../utils/logger.js';
import { MATCHING_DECISION_SERVICE_URL } from '../config/env.js';

const TIMEOUT_MS = 5000;

/**
 * Notify matching-decision-service to refresh recruiter_review_view
 * for recruiters that changed.
 *
 * @param recruiterIds Recruiter IDs to refresh
 */
export async function refreshRecruiterReviewViewForRecruiters(
  recruiterIds: number[]
): Promise<void> {
  if (!recruiterIds.length) return;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(
      `${MATCHING_DECISION_SERVICE_URL}/internal/recruiter-review-view/refresh-recruiter`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterIds }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        { status: response.status, recruiterIds },
        'Failed to refresh recruiter_review_view for recruiters'
      );
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, recruiterIds },
      'Fire-and-forget refresh call failed'
    );
  }
}
