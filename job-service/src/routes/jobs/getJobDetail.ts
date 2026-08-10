/**
 * Get Job Detail with Ranked Candidates (Local Implementation)
 *
 * Migration: Phase 1, Sprint 1.1
 * Previously: Proxied to monolith GET /api/jobs/:id
 * Now: Implemented locally by:
 * 1. Query job from local DB
 * 2. Fetch candidates from candidate-core-service (for job scoring)
 * 3. Rank candidates using matching-scoring-service
 * 4. Return enriched job detail with matched candidates + scores
 *
 * Dependencies:
 * - candidate-core-service: GET /internal/candidates/for-job-scoring
 * - matching-scoring-service: POST /internal/rank-candidates
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { getCandidatesForJobScoring } from '../../services/candidateCoreServiceClient.js';
import { rankCandidatesForJob } from '../../services/matchingScoringServiceClient.js';

export interface JobDetailResponse {
  id: number;
  company_id: number;
  title: string;
  description: string;
  location: string;
  salary_min: number;
  salary_max: number;
  required_skills: string[];
  optional_skills?: string[];
  experience_years: number;
  status: string;
  created_at: string;
  updated_at: string;
  // Matched candidates with scores
  matched_candidates: Array<{
    candidate: {
      id: number;
      email: string;
      first_name: string;
      last_name: string;
      skills: string[];
      experience_years: number;
    };
    match_score: number;
    breakdown?: Record<string, unknown>;
    summary?: string;
  }>;
}

/**
 * Get job detail with ranked candidates
 * @param jobId Job ID
 * @param companyId Company ID
 * @returns Job with matched candidates
 */
export async function getJobDetail(
  jobId: number,
  companyId: number
): Promise<JobDetailResponse | null> {
  try {
    // Step 1: Get job from local DB
    const job = await db.query(
      `SELECT * FROM jobs WHERE id = $1 AND company_id = $2`,
      [jobId, companyId]
    );

    if (job.rows.length === 0) {
      logger.debug({ jobId, companyId }, 'Job not found');
      return null;
    }

    const jobRecord = job.rows[0];

    // Step 2: Get candidates for job scoring from candidate-core-service
    // This is a bounded pool (recall-first, not hard exclusion)
    const candidates = await getCandidatesForJobScoring(
      companyId,
      jobRecord.required_skills || []
    );

    if (candidates.length === 0) {
      // No candidates matched, return job with empty matched_candidates
      return {
        ...jobRecord,
        matched_candidates: [],
      };
    }

    // Step 3: Rank candidates using matching-scoring-service
    const ranked = await rankCandidatesForJob(jobRecord, candidates, {
      tier: 'full',
      skipGeminiSummary: true,
      persist: { companyId, source: 'job_detail' },
    });

    // Step 4: Format response
    const matchedCandidates = ranked.map((r) => ({
      candidate: r.candidate,
      match_score: r.match_score,
      breakdown: r.score?.breakdown,
      summary: r.score?.summary,
    }));

    logger.debug(
      { jobId, matchedCount: matchedCandidates.length },
      'Fetched job detail with ranked candidates'
    );

    return {
      ...jobRecord,
      matched_candidates: matchedCandidates,
    };
  } catch (error) {
    logger.error(
      { err: (error as Error).message, jobId, companyId },
      'Failed to get job detail'
    );
    throw error;
  }
}
