// Enterprise AI Matching Architecture, Phases 11 + 12 + 13 + 15 - combined shadow-scoring
// orchestrator. (Phase 14, Labor Market Intelligence, was deferred - no real external data
// access exists - so this chain has four signals, not five.)
//
// Proficiency (Phase 11), career trajectory (Phase 12), skill recency (Phase 13), and reasoning
// alignment (Phase 15) multipliers are computed at the exact same decision moment and logged
// into the same proficiency_shadow_scores row, chained in that order (proficiency -> career ->
// recency -> reasoning, matching every phase's own spec integration example), so this is the one
// place that computes all four and does the single insert - no signal module needs to know about
// the others.

import { db } from '../db.js';
import { computeProficiencyShadowResult } from './proficiencyWeighting.js';
import { computeCareerShadowResult } from './careerWeighting.js';
import { computeRecencyShadowResult } from './recencyWeighting.js';
import { computeReasoningShadowResult } from './reasoningWeighting.js';
import type { Candidate, Job } from '../types.js';

export function logShadowScoresInBackground(companyId: number, candidate: Candidate, job: Job, matchedSkills: string[], baseScore: number, decisionAction: number | null): void {
  (async () => {
    const proficiency = await computeProficiencyShadowResult(candidate, matchedSkills, baseScore);
    const career = await computeCareerShadowResult(candidate, job, proficiency.proficiencyAdjustedScore);
    const recencyBaseline = career?.careerAdjustedScore ?? proficiency.proficiencyAdjustedScore;
    const recency = await computeRecencyShadowResult(candidate, job, matchedSkills, recencyBaseline);
    const reasoning = await computeReasoningShadowResult(candidate, job, recency.recencyAdjustedScore);

    await db.insertProficiencyShadowScore({
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
  })().catch((err) => console.error('Shadow scoring failed:', err?.message ?? err));
}
