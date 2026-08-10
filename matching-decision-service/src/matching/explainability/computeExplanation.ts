/**
 * Match Explanation Computation (Ported from Monolith)
 *
 * Computes the explainability narrative for a match:
 * - Why is this candidate good for this job?
 * - What concerns or gaps exist?
 * - What is the confidence/strength of the match?
 *
 * Pure functions - no side effects, no DB calls beyond data fetching
 * Used by: Item 3 (recruiter-review detail)
 */

import { logger } from '../../utils/logger.js';
import { CareerTrajectory, ReasoningConclusions, getCareerTrajectory, getReasoningConclusions } from '../../services/monolithExplainabilityClient.js';
import type { Candidate, Job, SwipeRow } from '../../types.js';

export interface MatchExplanation {
  narrative: string;
  concerns: string[];
  strengths: string[];
  confidenceScore: number;
  recommendationLevel: 'strong' | 'moderate' | 'weak' | 'not_recommended';
}

/**
 * Compute match explanation based on:
 * - Career trajectory (seniority, experience)
 * - Reasoning conclusions (reasoning about candidate/job)
 * - Match score (numerical confidence from swipe)
 *
 * @param careerTrajectory Candidate's career progression
 * @param candidateConclusions Candidate reasoning conclusions
 * @param jobConclusions Job reasoning conclusions
 * @param matchScore Numerical match score (0-1)
 * @returns Match explanation with narrative and structured data
 */
export function computeExplanation(
  careerTrajectory: CareerTrajectory | null,
  candidateConclusions: ReasoningConclusions | null,
  jobConclusions: ReasoningConclusions | null,
  matchScore: number
): MatchExplanation {
  const strengths: string[] = [];
  const concerns: string[] = [];
  let narrative = '';

  // Infer from career trajectory
  if (careerTrajectory) {
    const level = careerTrajectory.trajectory;
    const yearsInField = careerTrajectory.yearsInField;

    if (level === 'senior' || level === 'lead') {
      strengths.push(`${yearsInField}+ years of ${level}-level experience`);
    }

    if (level === 'junior' && yearsInField < 2) {
      concerns.push('Limited professional experience');
    }
  }

  // Extract from candidate conclusions
  if (candidateConclusions) {
    if (candidateConclusions.conclusions && candidateConclusions.conclusions.length > 0) {
      strengths.push(...candidateConclusions.conclusions.slice(0, 2));
    }
    if (candidateConclusions.confidence < 0.6) {
      concerns.push('Moderate confidence in candidate assessment');
    }
  }

  // Extract from job conclusions
  if (jobConclusions) {
    if (jobConclusions.conclusions && jobConclusions.conclusions.length > 0) {
      concerns.push(...jobConclusions.conclusions.slice(0, 2));
    }
  }

  // Determine recommendation level from match score
  let recommendationLevel: 'strong' | 'moderate' | 'weak' | 'not_recommended';
  if (matchScore >= 0.8) {
    recommendationLevel = 'strong';
    narrative = `Strong match. ${strengths.join('. ')}`;
  } else if (matchScore >= 0.6) {
    recommendationLevel = 'moderate';
    narrative = `Moderate match with potential. Key considerations: ${concerns.join(', ')}`;
  } else if (matchScore >= 0.4) {
    recommendationLevel = 'weak';
    narrative = `Weak match. Significant gaps in ${concerns.join(', ')}`;
  } else {
    recommendationLevel = 'not_recommended';
    narrative = `Not recommended for this role.`;
  }

  return {
    narrative,
    concerns,
    strengths,
    confidenceScore: matchScore,
    recommendationLevel,
  };
}

/**
 * Async wrapper that fetches career trajectory and reasoning conclusions from monolith,
 * then computes the match explanation
 *
 * @param candidate Candidate data
 * @param job Job data
 * @param swipeHistory Swipe history for this candidate-job pair
 * @returns Match explanation (or null on error)
 */
export async function computeMatchExplanation(
  candidate: Candidate,
  job: Job,
  swipeHistory: SwipeRow[]
): Promise<MatchExplanation | null> {
  try {
    const latestSwipe = swipeHistory[0];
    if (!latestSwipe) {
      return {
        narrative: 'No decision history yet for this candidate-job pair.',
        concerns: [],
        strengths: [],
        confidenceScore: 0,
        recommendationLevel: 'weak',
      };
    }

    const matchScore = (latestSwipe.score || 0) / 100; // Normalize to 0-1 range

    // Fetch explainability data from monolith (fire-and-forget, non-fatal)
    const [careerTrajectory, candidateConclusions, jobConclusions] = await Promise.all([
      getCareerTrajectory(candidate.id, candidate.company_id).catch(() => null),
      getReasoningConclusions('candidate', candidate.id).catch(() => null),
      getReasoningConclusions('job', job.id).catch(() => null),
    ]);

    return computeExplanation(careerTrajectory, candidateConclusions, jobConclusions, matchScore);
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Failed to compute match explanation');
    return null;
  }
}
