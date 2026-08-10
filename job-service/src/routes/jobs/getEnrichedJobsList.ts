/**
 * Get Enriched Jobs List (Local Implementation)
 *
 * Previously: Proxied to monolith's getEnrichedJobsList()
 * Now: Implemented locally by fanning out to 3 services:
 * 1. Get jobs from local DB (job-service)
 * 2. Get swipe counts from matching-decision-service
 * 3. Get candidate count from candidate-core-service
 * Then: Merge results and return
 *
 * This endpoint powers the jobs list page on the frontend.
 */

import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';
import { getSwipeCountsByJob } from '../../services/matchingDecisionServiceClient.js';
import { getCandidateCount } from '../../services/candidateCoreServiceClient.js';

interface EnrichedJob {
  id: number;
  company_id: number;
  title: string;
  description: string;
  location: string;
  status: string;
  created_at: string;
  updated_at: string;
  swipe_count: number;
  candidate_count: number;
}

/**
 * Fetch enriched jobs list for a company
 *
 * @param companyId Company to fetch jobs for
 * @returns Array of enriched job objects
 */
export async function getEnrichedJobsList(companyId: number): Promise<EnrichedJob[]> {
  try {
    // Step 1: Fetch jobs from local DB (this service owns jobs table)
    const jobsResult = await db.query(
      `
      SELECT
        id,
        company_id,
        title,
        description,
        location,
        status,
        created_at,
        updated_at
      FROM jobs
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      `,
      [companyId]
    );

    const jobs = jobsResult.rows;

    // Step 2: Fetch swipe counts from matching-decision-service
    const swipeCounts = await getSwipeCountsByJob(companyId);

    // Step 3: Fetch candidate count from candidate-core-service
    const candidateCount = await getCandidateCount(companyId);

    // Step 4: Merge results
    const enrichedJobs: EnrichedJob[] = jobs.map((job: any) => ({
      id: job.id,
      company_id: job.company_id,
      title: job.title,
      description: job.description,
      location: job.location,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      swipe_count: swipeCounts.get(job.id) || 0,
      candidate_count: candidateCount,
    }));

    logger.debug(
      { jobsCount: enrichedJobs.length, companyId },
      'Fetched enriched jobs list'
    );

    return enrichedJobs;
  } catch (error) {
    logger.error(
      { err: (error as Error).message, companyId },
      'Failed to get enriched jobs list'
    );
    throw error;
  }
}
