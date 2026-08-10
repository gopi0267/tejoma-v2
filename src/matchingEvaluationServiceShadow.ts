/**
 * Shadow-validation for the shadow-weighting cluster's Matching Evaluation Service extension
 * (Batch 31), same discipline as src/careerIntelligenceServiceShadow.ts (Batch 30) /
 * src/reasoningServiceShadow.ts (Batch 26). logShadowScoresInBackground already runs in the
 * background (fire-and-forget from swipe.routes.ts/recruiter-review.routes.ts) - no user-facing
 * response to piggyback a shadow call onto. This module is a drop-in replacement for it - same
 * name, same signature, same real local computation (the unchanged, ported original in
 * matching/shadowScoring.ts), with an ADDITIONAL shadow comparison against
 * matching-evaluation-service bolted on only when enabled. The monolith's own local computation
 * and its proficiency_shadow_scores write happen exactly as they always have, whether or not the
 * shadow comparison runs afterward.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_MATCHING_EVALUATION_ENABLED must be exactly 'true').
 *   2. Never affects real behavior - the monolith's own logShadowScoresInBackground computation
 *      and its db.insertProficiencyShadowScore write are completely unchanged.
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';
import { computeProficiencyShadowResult } from './matching/proficiencyWeighting.js';
import { computeCareerShadowResult } from './matching/careerWeighting.js';
import { computeRecencyShadowResult } from './matching/recencyWeighting.js';
import { computeReasoningShadowResult } from './matching/reasoningWeighting.js';
import { db } from './db.js';
import type { Candidate, Job } from './types.js';

export const SHADOW_MATCHING_EVALUATION_ENABLED = process.env.SHADOW_MATCHING_EVALUATION_ENABLED === 'true';

const MATCHING_EVALUATION_SERVICE_URL = process.env.MATCHING_EVALUATION_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 10000;

const COMPARABLE_FIELDS = [
  'proficiency_adjusted_score', 'overall_multiplier', 'career_multiplier', 'career_progression_signal',
  'career_stability_signal', 'career_domain_signal', 'career_adjusted_score', 'career_progression_type',
  'recency_multiplier', 'recency_adjusted_score', 'recency_role_expectation', 'reasoning_multiplier',
  'reasoning_density_signal', 'reasoning_coverage_signal', 'reasoning_quality_signal', 'reasoning_adjusted_score',
] as const;

function canonicalize(row: Record<string, unknown> | null): string {
  if (!row) return 'null';
  return JSON.stringify(COMPARABLE_FIELDS.map((f) => row[f]));
}

async function shadowCompare(
  companyId: number,
  candidate: Candidate,
  job: Job,
  matchedSkills: string[],
  baseScore: number,
  decisionAction: number | null,
  monolithComputation: Record<string, unknown> | null
): Promise<void> {
  if (!MATCHING_EVALUATION_SERVICE_URL) {
    logger.warn('SHADOW_MATCHING_EVALUATION_ENABLED is true but MATCHING_EVALUATION_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${MATCHING_EVALUATION_SERVICE_URL}/internal/compute-shadow-weighting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        candidate: {
          id: candidate.id,
          company_id: candidate.company_id,
          resume_summary: candidate.resume_summary,
          project_entries: candidate.project_entries,
          certifications: candidate.certifications,
        },
        job: { id: job.id, title: job.title },
        matchedSkills,
        baseScore,
        decisionAction,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, candidateId: candidate.id, jobId: job.id }, 'Shadow-validation call to matching-evaluation-service returned a non-OK status - comparison skipped');
      return;
    }

    const responseBody = (await response.json()) as { computation: Record<string, unknown> | null };
    const monolithCanonical = canonicalize(monolithComputation);
    const serviceCanonical = canonicalize(responseBody.computation);

    if (monolithCanonical !== serviceCanonical) {
      logger.error(
        { candidateId: candidate.id, jobId: job.id, monolith: monolithCanonical, matchingEvaluationService: serviceCanonical },
        'SHADOW-VALIDATION DIVERGENCE: monolith and matching-evaluation-service computed different shadow-weighting results'
      );
      return;
    }

    logger.debug({ candidateId: candidate.id, jobId: job.id }, 'Shadow-validation agreement: matching-evaluation-service matched the monolith for this candidate/job pair');
  } catch (error: any) {
    logger.warn({ err: error?.message, candidateId: candidate.id, jobId: job.id }, 'Shadow-validation call to matching-evaluation-service failed - comparison skipped');
  }
}

/** Drop-in replacement for matching/shadowScoring.ts's own logShadowScoresInBackground - same signature, same real local computation, plus an optional shadow comparison. */
export function logShadowScoresInBackground(companyId: number, candidate: Candidate, job: Job, matchedSkills: string[], baseScore: number, decisionAction: number | null): void {
  (async () => {
    const proficiency = await computeProficiencyShadowResult(candidate, matchedSkills, baseScore);
    const career = await computeCareerShadowResult(candidate, job, proficiency.proficiencyAdjustedScore);
    const recencyBaseline = career?.careerAdjustedScore ?? proficiency.proficiencyAdjustedScore;
    const recency = await computeRecencyShadowResult(candidate, job, matchedSkills, recencyBaseline);
    const reasoning = await computeReasoningShadowResult(candidate, job, recency.recencyAdjustedScore);

    const record = {
      company_id: companyId,
      candidate_id: candidate.id,
      job_id: job.id,
      base_match_score: baseScore,
      proficiency_adjusted_score: proficiency.proficiencyAdjustedScore,
      overall_multiplier: proficiency.overallMultiplier,
      skill_multipliers: proficiency.skillMultipliers,
      decision_action: decisionAction,
      career_multiplier: career?.careerMultiplier.multiplier ?? null,
      career_progression_signal: career?.careerMultiplier.progressionSignal ?? null,
      career_stability_signal: career?.careerMultiplier.stabilitySignal ?? null,
      career_domain_signal: career?.careerMultiplier.domainSignal ?? null,
      career_adjusted_score: career?.careerAdjustedScore ?? null,
      career_progression_type: career?.progressionType ?? null,
      recency_multiplier: recency.overallMultiplier,
      recency_adjusted_score: recency.recencyAdjustedScore,
      recency_role_expectation: recency.roleExpectation,
      recency_skill_multipliers: recency.skillMultipliers,
      reasoning_multiplier: reasoning.result.multiplier,
      reasoning_density_signal: reasoning.result.densitySignal,
      reasoning_coverage_signal: reasoning.result.coverageSignal,
      reasoning_quality_signal: reasoning.result.qualitySignal,
      reasoning_adjusted_score: reasoning.reasoningAdjustedScore,
      reasoning_covered_domains: reasoning.result.coveredDomains,
      reasoning_uncovered_domains: reasoning.result.uncoveredDomains,
    };

    await db.insertProficiencyShadowScore(record);

    if (SHADOW_MATCHING_EVALUATION_ENABLED) {
      shadowCompare(companyId, candidate, job, matchedSkills, baseScore, decisionAction, record);
    }
  })().catch((err) => logger.warn({ err: err?.message ?? err, candidateId: candidate.id, jobId: job.id }, 'Shadow scoring failed'));
}
