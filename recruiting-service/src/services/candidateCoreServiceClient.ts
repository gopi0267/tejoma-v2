/**
 * Candidate Core Service Client (recruiting-service)
 *
 * Calls candidate-core-service to fetch candidate details for recruiter-matches enrichment.
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const CANDIDATE_CORE_SERVICE_URL =
  process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';
const REQUEST_TIMEOUT = 5000; // 5 seconds

interface Candidate {
  id: number;
  name: string;
  email: string;
  skills?: string[];
  years_of_experience?: number;
  [key: string]: any;
}

/**
 * Get candidates by IDs
 *
 * @param candidateIds Array of candidate IDs
 * @param companyId Company ID (for scope validation)
 * @returns Map of candidate ID to candidate object
 */
export async function getCandidatesByIds(
  candidateIds: number[],
  companyId: number
): Promise<Map<number, Candidate>> {
  if (candidateIds.length === 0) {
    return new Map();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/by-ids?ids=${candidateIds.join(',')}&companyId=${companyId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, candidateCount: candidateIds.length },
        'Failed to get candidates from candidate-core-service'
      );
      return new Map();
    }

    const data: { candidates: Candidate[] } = await response.json();
    const candidateMap = new Map<number, Candidate>();
    (data.candidates || []).forEach((candidate) => {
      candidateMap.set(candidate.id, candidate);
    });
    return candidateMap;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn(
        { candidateCount: candidateIds.length },
        'getCandidatesByIds: Request timeout (5s)'
      );
    } else {
      logger.warn(
        { err: error.message, candidateCount: candidateIds.length },
        'Failed to call candidate-core-service'
      );
    }
    return new Map();
  }
}
