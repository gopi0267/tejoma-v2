/**
 * Matching Decision Service Client
 *
 * Calls internal endpoints on matching-decision-service to fetch:
 * - Latest swipes per (candidate_id, job_id) pair
 * - Used for: Item 2 (shortlisted tab), Item 5 (CQRS backfill)
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const MATCHING_DECISION_SERVICE_URL = process.env.MATCHING_DECISION_SERVICE_URL || 'http://localhost:4020';
const REQUEST_TIMEOUT = 5000; // 5 seconds

export interface LatestSwipe {
  id: number;
  candidate_id: number;
  job_id: number;
  company_id: number;
  action: number;
  score: number;
  reason?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get latest swipes per (candidate, job) pair for a company
 *
 * @param companyId Company ID to fetch swipes for
 * @param action Optional action filter (e.g., 1 for accepted)
 * @returns Array of latest swipes (empty array if service unavailable)
 */
export async function getLatestSwipesPerPair(
  companyId: number,
  action?: number
): Promise<LatestSwipe[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let url = `${MATCHING_DECISION_SERVICE_URL}/internal/swipes/latest-per-pair?companyId=${companyId}`;
    if (action !== undefined) {
      url += `&action=${action}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Failed to fetch latest swipes from matching-decision-service'
      );
      return [];
    }

    const swipes: LatestSwipe[] = await response.json();
    return swipes;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn('getLatestSwipesPerPair: Request timeout (5s)');
    } else {
      logger.warn({ err: error.message }, 'Failed to call matching-decision-service');
    }
    return [];
  }
}

/**
 * Get shortlisted swipes (action=1) for a company
 * Convenience wrapper used by Item 2: candidate-search/tab/shortlisted
 *
 * @param companyId Company ID
 * @returns Array of accepted swipes
 */
export async function getShortlistedSwipes(companyId: number): Promise<LatestSwipe[]> {
  return getLatestSwipesPerPair(companyId, 1);
}
