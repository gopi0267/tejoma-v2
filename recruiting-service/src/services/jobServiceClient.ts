/**
 * Job Service Client (recruiting-service)
 *
 * Calls job-service to fetch job details for recruiter-matches enrichment.
 *
 * Pattern: Fire-and-forget, 5-second timeout, never throws
 */

import { logger } from '../utils/logger.js';

const JOB_SERVICE_URL =
  process.env.JOB_SERVICE_URL || 'http://localhost:4018';
const REQUEST_TIMEOUT = 5000; // 5 seconds

interface Job {
  id: number;
  title: string;
  [key: string]: any;
}

/**
 * Get jobs by IDs
 *
 * @param jobIds Array of job IDs
 * @returns Map of job ID to job object
 */
export async function getJobsByIds(
  jobIds: number[]
): Promise<Map<number, Job>> {
  if (jobIds.length === 0) {
    return new Map();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(
      `${JOB_SERVICE_URL}/internal/jobs/by-ids?ids=${jobIds.join(',')}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status, jobCount: jobIds.length },
        'Failed to get jobs from job-service'
      );
      return new Map();
    }

    const data: { jobs: Job[] } = await response.json();
    const jobMap = new Map<number, Job>();
    (data.jobs || []).forEach((job) => {
      jobMap.set(job.id, job);
    });
    return jobMap;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn(
        { jobCount: jobIds.length },
        'getJobsByIds: Request timeout (5s)'
      );
    } else {
      logger.warn(
        { err: error.message, jobCount: jobIds.length },
        'Failed to call job-service'
      );
    }
    return new Map();
  }
}
