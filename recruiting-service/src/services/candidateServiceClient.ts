/**
 * Candidate Service Client (recruiting-service)
 *
 * Calls candidate-service to fetch mutual matches data.
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const CANDIDATE_SERVICE_URL =
  process.env.CANDIDATE_SERVICE_URL || 'http://localhost:4016';
const REQUEST_TIMEOUT = 5000; // 5 seconds

interface Match {
  id: number;
  company_id: number;
  candidate_id: number;
  job_id: number;
  matched_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get mutual matches for a company
 *
 * @param companyId Company ID
 * @param jobId Optional job ID to filter by
 * @returns Array of matches
 */
export async function getMatchesByCompany(
  companyId: number,
  jobId?: number
): Promise<Match[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const url = new URL(`${CANDIDATE_SERVICE_URL}/internal/matches/by-company`);
    url.searchParams.set('companyId', String(companyId));
    if (jobId) {
      url.searchParams.set('jobId', String(jobId));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, companyId, jobId },
        'Failed to get matches from candidate-service'
      );
      return [];
    }

    const data: { matches: Match[] } = await response.json();
    return data.matches || [];
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn(
        { companyId, jobId },
        'getMatchesByCompany: Request timeout (5s)'
      );
    } else {
      logger.warn(
        { err: error.message, companyId, jobId },
        'Failed to call candidate-service'
      );
    }
    return [];
  }
}
