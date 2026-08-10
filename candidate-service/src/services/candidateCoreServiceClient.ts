/**
 * Candidate Core Service Client
 *
 * Calls internal endpoints on candidate-core-service to fetch:
 * - Candidate details by list of IDs
 * - Used for: Item 2 (shortlisted tab enrichment)
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';
const REQUEST_TIMEOUT = 5000; // 5 seconds

export interface CandidateDetails {
  id: number;
  company_id: number;
  email: string;
  phone?: string;
  first_name: string;
  last_name: string;
  skills?: string;
  experience_years?: number;
  education?: string;
  candidate_account_id?: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get candidate details by list of IDs
 *
 * @param ids Array of candidate IDs to fetch
 * @returns Map of candidate_id → candidate details (empty map if service unavailable)
 */
export async function getCandidatesByIds(ids: number[]): Promise<Map<number, CandidateDetails>> {
  if (!ids || ids.length === 0) {
    return new Map();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const idList = ids.join(',');
    const url = `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/by-ids?ids=${idList}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Failed to fetch candidates from candidate-core-service'
      );
      return new Map();
    }

    const data: { candidates: CandidateDetails[] } = await response.json();
    const map = new Map<number, CandidateDetails>();

    for (const candidate of data.candidates || []) {
      map.set(candidate.id, candidate);
    }

    return map;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn('getCandidatesByIds: Request timeout (5s)');
    } else {
      logger.warn({ err: error.message }, 'Failed to call candidate-core-service');
    }
    return new Map();
  }
}
