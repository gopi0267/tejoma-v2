// Ported from the monolith's src/matching/shadowScoring.ts, adapted for this service's own
// ownership shape (Batch 31). The monolith's orchestrator inserts into proficiency_shadow_scores
// (this service's own READ-ONLY mirror of that table, dual-written since Batch 25 - untouched by
// this file). This service's own copy of the orchestrator instead stores into
// shadow_weighting_computations, its OWN independently-computed table - the two intentionally
// never merge; see migrations/003_shadow_cluster.up.sql's header comment for the full reasoning.
//
// Computation logic itself (the four-signal chain, chained in the same order) is byte-identical to
// the monolith's original.

import { db } from '../db.js';
import { computeProficiencyShadowResult } from './proficiencyWeighting.js';
import { computeCareerShadowResult } from './careerWeighting.js';
import { computeRecencyShadowResult } from './recencyWeighting.js';
import { computeReasoningShadowResult } from './reasoningWeighting.js';
import type { ShadowCandidate, ShadowJob } from '../types.js';

export async function computeShadowWeighting(companyId: number, candidate: ShadowCandidate, job: ShadowJob, matchedSkills: string[], baseScore: number, decisionAction: number | null) {
  const proficiency = await computeProficiencyShadowResult(candidate, matchedSkills, baseScore);
  const career = await computeCareerShadowResult(candidate, job, proficiency.proficiencyAdjustedScore);
  const recencyBaseline = career?.careerAdjustedScore ?? proficiency.proficiencyAdjustedScore;
  const recency = await computeRecencyShadowResult(candidate, job, matchedSkills, recencyBaseline);
  const reasoning = await computeReasoningShadowResult(candidate, job, recency.recencyAdjustedScore);

  return db.insertShadowWeightingComputation({
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
  });
}
