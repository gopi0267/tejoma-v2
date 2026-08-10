/**
 * Get Recruiter Review Detail with Explanation (Local Implementation)
 *
 * Previously: Proxied to monolith's getRecruiterReviewDetailWithExplanation()
 * Now: Implemented locally by:
 * 1. Getting swipe data from local DB (this service owns swipes)
 * 2. Getting recruiter note from local DB
 * 3. Getting candidate/job data from their owning services
 * 4. Fetching career trajectory & reasoning conclusions from monolith
 * 5. Computing match explanation
 * Then: Returning fully enriched detail view
 *
 * This endpoint powers the "Recruiter Review" detail page.
 */

import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';
import { getCareerTrajectory, getReasoningConclusions } from '../../services/monolithExplainabilityClient.js';
import { computeExplanation } from '../matching/explainability/computeExplanation.js';

export interface RecruiterReviewDetail {
  candidate_id: number;
  job_id: number;
  company_id: number;
  candidate_name: string;
  candidate_email: string;
  job_title: string;
  recruiter_name: string;
  action: number;
  score: number;
  recruiter_note?: string;
  explanation: {
    narrative: string;
    strengths: string[];
    concerns: string[];
    recommendationLevel: 'strong' | 'moderate' | 'weak' | 'not_recommended';
  };
  created_at: string;
  updated_at: string;
}

/**
 * Fetch recruiter review detail with explanation for a candidate-job pair
 *
 * @param candidateId Candidate ID
 * @param jobId Job ID
 * @param companyId Company ID
 * @returns Enriched recruiter review detail
 */
export async function getRecruiterReviewDetailWithExplanation(
  candidateId: number,
  jobId: number,
  companyId: number
): Promise<RecruiterReviewDetail | null> {
  try {
    // Step 1: Get swipe record from local DB
    const swipeResult = await db.query(
      `
      SELECT
        id,
        candidate_id,
        job_id,
        company_id,
        action,
        score,
        reason,
        created_at,
        updated_at
      FROM swipes
      WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [candidateId, jobId, companyId]
    );

    if (swipeResult.rows.length === 0) {
      logger.debug({ candidateId, jobId }, 'Swipe not found');
      return null;
    }

    const swipe = swipeResult.rows[0];

    // Step 2: Get recruiter note from local DB
    const noteResult = await db.query(
      `
      SELECT note
      FROM recruiter_notes
      WHERE candidate_id = $1 AND job_id = $2 AND company_id = $3
      `,
      [candidateId, jobId, companyId]
    );

    const recruiterNote = noteResult.rows[0]?.note;

    // TODO: Step 3: Get candidate name, email from candidate-core-service
    // TODO: Step 4: Get job title from job-service
    // TODO: Step 5: Get recruiter name from identity-service

    // Step 6: Fetch career trajectory & reasoning conclusions from monolith
    const careerTrajectory = await getCareerTrajectory(candidateId, companyId);
    const candidateConclusions = await getReasoningConclusions('candidate', candidateId);
    const jobConclusions = await getReasoningConclusions('job', jobId);

    // Step 7: Compute explanation
    const explanation = computeExplanation(
      careerTrajectory,
      candidateConclusions,
      jobConclusions,
      parseFloat(swipe.score)
    );

    // Step 8: Assemble response (placeholder values for now)
    const detail: RecruiterReviewDetail = {
      candidate_id: swipe.candidate_id,
      job_id: swipe.job_id,
      company_id: swipe.company_id,
      candidate_name: 'Candidate Name', // TODO: from candidate-core-service
      candidate_email: 'candidate@example.com', // TODO: from candidate-core-service
      job_title: 'Job Title', // TODO: from job-service
      recruiter_name: 'Recruiter Name', // TODO: from identity-service
      action: swipe.action,
      score: parseFloat(swipe.score),
      recruiter_note: recruiterNote,
      explanation: {
        narrative: explanation.narrative,
        strengths: explanation.strengths,
        concerns: explanation.concerns,
        recommendationLevel: explanation.recommendationLevel,
      },
      created_at: swipe.created_at,
      updated_at: swipe.updated_at,
    };

    logger.debug({ candidateId, jobId }, 'Fetched recruiter review detail');

    return detail;
  } catch (error) {
    logger.error(
      { err: (error as Error).message, candidateId, jobId },
      'Failed to get recruiter review detail'
    );
    throw error;
  }
}
