/**
 * Explainability Data Client
 *
 * Item 10: Calls service endpoints to fetch:
 * - Career trajectory for candidate (from matching-reasoning-service)
 * - Reasoning conclusions (from matching-evaluation-service)
 *
 * Fallback to monolith for backward compatibility during transition.
 * Used by: Item 3 (recruiter-review detail computation)
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const MONOLITH_INTERNAL_URL = process.env.MONOLITH_INTERNAL_URL || 'http://localhost:3000';
const MATCHING_REASONING_SERVICE_URL = process.env.MATCHING_REASONING_SERVICE_URL || 'http://localhost:4024';
const MATCHING_EVALUATION_SERVICE_URL = process.env.MATCHING_EVALUATION_SERVICE_URL || 'http://localhost:4023';
const REQUEST_TIMEOUT = 5000; // 5 seconds
const EXPLANATION_CUTOVER_ENABLED = process.env.EXPLANATION_GENERATION_CUTOVER_ENABLED === 'true';

export interface CareerTrajectory {
  candidateId: number;
  companyId: number;
  positions: string[];
  trajectory: 'junior' | 'mid' | 'senior' | 'lead';
  yearsInField: number;
}

export interface ReasoningConclusions {
  subjectType: 'candidate' | 'job';
  subjectId: number;
  conclusions: string[];
  reasoning: string;
  confidence: number;
}

/**
 * Get career trajectory for a candidate
 *
 * @param candidateId Candidate to fetch trajectory for
 * @param companyId Company context
 * @returns Career trajectory (null if not found or service unavailable)
 */
export async function getCareerTrajectory(
  candidateId: number,
  companyId: number
): Promise<CareerTrajectory | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Item 10: Use service endpoint if cutover enabled, otherwise fallback to monolith
    const url = EXPLANATION_CUTOVER_ENABLED
      ? `${MATCHING_REASONING_SERVICE_URL}/internal/career-trajectory?candidateId=${candidateId}`
      : `${MONOLITH_INTERNAL_URL}/internal/career-trajectory?candidateId=${candidateId}&companyId=${companyId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 404) {
      logger.debug({ candidateId }, 'Career trajectory not found');
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText, source: EXPLANATION_CUTOVER_ENABLED ? 'service' : 'monolith' },
        'Failed to fetch career trajectory'
      );
      return null;
    }

    const trajectory: CareerTrajectory = await response.json();
    return trajectory;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn({ candidateId }, 'getCareerTrajectory: Request timeout (5s)');
    } else {
      logger.warn({ err: error.message, candidateId }, 'Failed to call career trajectory API');
    }
    return null;
  }
}

/**
 * Get reasoning conclusions for a candidate or job
 *
 * @param subjectType "candidate" or "job"
 * @param subjectId ID of the candidate or job
 * @returns Reasoning conclusions (null if not found or service unavailable)
 */
export async function getReasoningConclusions(
  subjectType: 'candidate' | 'job',
  subjectId: number
): Promise<ReasoningConclusions | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Item 10: Use service endpoint if cutover enabled, otherwise fallback to monolith
    const url = EXPLANATION_CUTOVER_ENABLED
      ? `${MATCHING_EVALUATION_SERVICE_URL}/internal/reasoning-conclusions?subjectType=${subjectType}&subjectId=${subjectId}`
      : `${MONOLITH_INTERNAL_URL}/internal/reasoning-conclusions?subjectType=${subjectType}&subjectId=${subjectId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 404) {
      logger.debug({ subjectType, subjectId }, 'Reasoning conclusions not found');
      return null;
    }

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText, source: EXPLANATION_CUTOVER_ENABLED ? 'service' : 'monolith' },
        'Failed to fetch reasoning conclusions'
      );
      return null;
    }

    const conclusions: ReasoningConclusions = await response.json();
    return conclusions;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn({ subjectType, subjectId }, 'getReasoningConclusions: Request timeout (5s)');
    } else {
      logger.warn(
        { err: error.message, subjectType, subjectId },
        'Failed to call reasoning conclusions API'
      );
    }
    return null;
  }
}
