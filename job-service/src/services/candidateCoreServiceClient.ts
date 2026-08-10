/**
 * Candidate Core Service Client
 *
 * Calls internal endpoints on candidate-core-service to fetch:
 * - Candidate count for company (for job enrichment)
 * - Candidates for job scoring (bounded pool for matching)
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 * If service unavailable: Return empty/0, monolith fallback handles it
 */

import { logger } from '../utils/logger.js';

const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4011';
const REQUEST_TIMEOUT = 5000; // 5 seconds

interface Candidate {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  skills: string[];
  experience_years: number;
  location?: string;
}

/**
 * Get count of active candidates for a company
 *
 * @param companyId Company ID to fetch candidate count for
 * @returns Candidate count (0 if service unavailable)
 */
export async function getCandidateCount(companyId: number): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/count?companyId=${companyId}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        'Failed to fetch candidate count from candidate-core-service'
      );
      return 0;
    }

    const data: { count: number } = await response.json();
    return data.count || 0;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn('getCandidateCount: Request timeout (5s)');
    } else {
      logger.warn({ err: error.message }, 'Failed to call candidate-core-service');
    }
    return 0;
  }
}

/**
 * Get candidates for job scoring (bounded pool, recall-first prioritization)
 *
 * This is NOT a hard exclusion filter - it's a bounded, recall-first pool
 * that prioritizes candidates with matching skills but includes others.
 *
 * @param companyId Company ID
 * @param requiredSkills Job's required skills (used to prioritize pool)
 * @returns Array of candidate objects (empty array if service unavailable)
 */
export async function getCandidatesForJobScoring(
  companyId: number,
  requiredSkills: string[]
): Promise<Candidate[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const queryParams = new URLSearchParams({
      companyId: String(companyId),
      requiredSkills: requiredSkills.join(','),
    });

    const response = await fetch(
      `${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/for-job-scoring?${queryParams}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText, companyId },
        'Failed to fetch candidates for job scoring from candidate-core-service'
      );
      return [];
    }

    const data: { candidates: Candidate[] } = await response.json();
    return data.candidates || [];
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn({ companyId }, 'getCandidatesForJobScoring: Request timeout (5s)');
    } else {
      logger.warn({ err: error.message, companyId }, 'Failed to call candidate-core-service');
    }
    return [];
  }
}
