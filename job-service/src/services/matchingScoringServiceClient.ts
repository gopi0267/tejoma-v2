/**
 * Matching Scoring Service Client (job-service)
 *
 * Calls matching-scoring-service to rank candidates for a job.
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 * If service unavailable: Return candidates unsorted (no harm, monolith fallback)
 */

import { logger } from '../utils/logger.js';

const MATCHING_SCORING_SERVICE_URL =
  process.env.MATCHING_SCORING_SERVICE_URL || 'http://localhost:4021';
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

interface RankedCandidate {
  candidate: Candidate;
  match_score: number;
  score?: {
    breakdown?: Record<string, unknown>;
    summary?: string;
  };
}

/**
 * Rank candidates for a job using matching-scoring-service
 *
 * @param job Job object
 * @param candidates Array of candidate objects
 * @param options Ranking options (tier, skipGeminiSummary, persist)
 * @returns Ranked candidates with match scores
 */
export async function rankCandidatesForJob(
  job: any,
  candidates: Candidate[],
  options: {
    tier?: 'quick' | 'full';
    skipGeminiSummary?: boolean;
    persist?: { companyId: number; source: string };
  }
): Promise<RankedCandidate[]> {
  if (candidates.length === 0) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `${MATCHING_SCORING_SERVICE_URL}/internal/rank-candidates-for-job`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job,
          candidates,
          tier: options.tier || 'full',
          skipGeminiSummary: options.skipGeminiSummary ?? true,
          persist: options.persist,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, jobId: job.id, candidateCount: candidates.length },
        'Failed to rank candidates from matching-scoring-service'
      );
      // Return candidates unsorted if ranking fails (better than error)
      return candidates.map((c) => ({
        candidate: c,
        match_score: 0,
      }));
    }

    const data: { ranked: RankedCandidate[] } = await response.json();
    return data.ranked || [];
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn(
        { jobId: job.id, candidateCount: candidates.length },
        'rankCandidatesForJob: Request timeout (5s)'
      );
    } else {
      logger.warn(
        { err: error.message, jobId: job.id },
        'Failed to call matching-scoring-service'
      );
    }
    // Return candidates unsorted (graceful degradation)
    return candidates.map((c) => ({
      candidate: c,
      match_score: 0,
    }));
  }
}
