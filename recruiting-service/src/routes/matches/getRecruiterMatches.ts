/**
 * Get Recruiter Matches (Local Implementation with Cross-Service Orchestration)
 *
 * Migration: Phase 1, Sprint 1.4
 * Previously: Proxied to monolith GET /internal/recruiting/matches
 * Now: Implemented via orchestration of candidate-service + job-service + candidate-core-service
 *
 * This endpoint returns matches involving the recruiter's company's jobs:
 * - Mutual match records (from candidate-service)
 * - Job details (title, location, etc. from job-service)
 * - Candidate details (name, email, skills from candidate-core-service)
 * - Notification status (read/unread, local to recruiting-service)
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';
import { getMatchesByCompany } from '../../services/candidateServiceClient.js';
import { getJobsByIds } from '../../services/jobServiceClient.js';
import { getCandidatesByIds } from '../../services/candidateCoreServiceClient.js';

export interface RecruiterMatchesResponse {
  id: number;
  job_id: number;
  matched_at: string;
  job_title?: string | null;
  candidate_id: number;
  candidate_name?: string | null;
  candidate_email?: string | null;
  candidate_skills?: string[] | null;
  candidate_years_of_experience?: number | null;
  notification_id?: number | null;
  read_at?: string | null;
}

/**
 * Get recruiter matches for a company
 * @param companyId Company ID (for scope isolation)
 * @param jobId Optional job ID (to filter by specific job)
 * @param userId Recruiter user ID (for notification scoping)
 * @returns Array of recruiter match records with enriched data
 */
export async function getRecruiterMatches(
  companyId: number,
  jobId?: number,
  userId?: number
): Promise<RecruiterMatchesResponse[]> {
  try {
    // Step 1: Get mutual matches from candidate-service
    const matches = await getMatchesByCompany(companyId, jobId);
    if (matches.length === 0) {
      logger.debug({ companyId, jobId }, 'No matches found');
      return [];
    }

    // Step 2: Extract unique IDs for batch fetching
    const uniqueJobIds = [...new Set(matches.map((m) => m.job_id))];
    const uniqueCandidateIds = [...new Set(matches.map((m) => m.candidate_id))];

    // Step 3: Fetch job and candidate data in parallel (fire-and-forget)
    const [jobsMap, candidatesMap] = await Promise.all([
      getJobsByIds(uniqueJobIds),
      getCandidatesByIds(uniqueCandidateIds, companyId),
    ]);

    // Step 4: Get notification data (local)
    const notificationMap = new Map<number, { id: number; read_at: string | null }>();
    if (userId) {
      try {
        const notifications = await db.getRecruiterNotifications(userId, companyId);
        notifications.forEach((n) => {
          notificationMap.set(n.match_id, { id: n.id, read_at: n.read_at });
        });
      } catch (error) {
        logger.warn(
          { err: (error as Error).message, userId, companyId },
          'Failed to fetch notifications'
        );
        // Continue without notifications - they're optional
      }
    }

    // Step 5: Merge all data
    const result: RecruiterMatchesResponse[] = matches.map((match) => ({
      id: match.id,
      job_id: match.job_id,
      matched_at: match.matched_at,
      job_title: jobsMap.get(match.job_id)?.title || null,
      candidate_id: match.candidate_id,
      candidate_name: candidatesMap.get(match.candidate_id)?.name || null,
      candidate_email: candidatesMap.get(match.candidate_id)?.email || null,
      candidate_skills: candidatesMap.get(match.candidate_id)?.skills || null,
      candidate_years_of_experience:
        candidatesMap.get(match.candidate_id)?.years_of_experience || null,
      notification_id: notificationMap.get(match.id)?.id || null,
      read_at: notificationMap.get(match.id)?.read_at || null,
    }));

    logger.debug(
      { companyId, jobId, matchCount: result.length },
      'Fetched recruiter matches via orchestration'
    );

    return result;
  } catch (error) {
    logger.error(
      { err: (error as Error).message, companyId, jobId },
      'Failed to get recruiter matches'
    );
    throw error;
  }
}
