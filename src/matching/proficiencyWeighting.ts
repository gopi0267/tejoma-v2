// Enterprise AI Matching Architecture, Phase 11 - §2.1 Proficiency Weighting, SHADOW MODE ONLY.
//
// SCOPE, per explicit user decision: this phase computes and logs what a proficiency-weighted
// match score WOULD be, alongside every real decision - it never changes a live match score,
// ranking, or anything a recruiter/candidate sees. The original spec's Decision 1-6 (full A/B
// experiment platform, live traffic rollout, real-time monitoring/alerting, demographic fairness
// audit) is not built here, for two separate, hard reasons rather than a scope preference:
//
//   1. No demographic data exists anywhere in this schema. The spec's own Decision 5 (fairness
//      audit) and its "Offer Rate Disparity by demographic group" guardrail are GATING
//      requirements the spec itself says must pass before this goes live - not optional
//      extras. There is nothing to audit, so this cannot honestly be marked "ready for live
//      traffic" regardless of how well the formula below performs in shadow.
//   2. No A/B experimentation platform, feature-flag traffic-splitter, or alerting/dashboard
//      infrastructure (Slack, PagerDuty, etc.) exists in this codebase. Building one is a
//      separate, large undertaking unrelated to recruiting - not something to invent as a
//      side effect of "wire in proficiency."
//
// A second, independent correction: the spec's "job expectation" (Decision 4) assumes
// role_profiles carries a per-skill proficiency_tier expectation ("Python: Intermediate+").
// role_profiles only ever stored flat skill-name lists (mandatory_skills/preferred_skills/
// optional_skills - see skillIntelligence.ts, Phase 1) - no job posting or role profile in this
// codebase has ever captured a per-skill proficiency bar. The spec's own fallback chain's first
// two tiers therefore have no real data source; only its third tier (a flat default) is honest
// to implement. DEFAULT_EXPECTED_TIER below is that flat default, applied to every skill on
// every job - a real but much weaker signal than the spec's worked examples imply, since it's
// "is the candidate above or below one fixed midpoint" rather than a genuine per-role bar.

import { computeCandidateSkillProficiency } from './skillProficiency.js';
import type { ProficiencyTier } from './skillProficiency.js';
import type { Candidate, ProficiencyTierMatchType, SkillProficiencyMultiplier } from '../types.js';

const TIER_INDEX: Record<ProficiencyTier, number> = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 };

// No real per-skill/per-role expectation data exists (see module doc) - this is the one honest
// fallback: a flat midpoint applied uniformly, not a per-role or per-skill signal.
export const DEFAULT_EXPECTED_TIER: ProficiencyTier = 'intermediate';

const BOOST_PER_TIER = 0.10;
const PENALTY_PER_TIER = 0.15;
const MAX_MULTIPLIER = 1.3;
const MIN_MULTIPLIER = 0.5;

// Unifies the original spec's Decision 1 rules 3 ("confidence unknown -> neutral 1.0") and 4
// ("interpolate by confidence") into one continuous formula: blending the raw tier-comparison
// multiplier toward 1.0 (neutral) in proportion to confidence. confidence=0 -> exactly 1.0
// (rule 3); confidence=1 -> the full raw multiplier (rule 4's "1.0 confidence -> full effect").
// The spec's own worked example for the <0.60 case ("confidence 0.6 -> 50% of full effect")
// doesn't actually follow its own stated linear-interpolation rule (0.6 would give 60%, not
// 50%) - rather than reverse-engineer an inexact example, this uses the clean, consistent
// linear version.
export function calculateProficiencyMultiplier(
  candidateTier: ProficiencyTier,
  candidateConfidence: number,
  expectedTier: ProficiencyTier = DEFAULT_EXPECTED_TIER
): { multiplier: number; matchType: ProficiencyTierMatchType; reasoning: string } {
  const candidateIdx = TIER_INDEX[candidateTier];
  const expectedIdx = TIER_INDEX[expectedTier];

  let rawMultiplier: number;
  let matchType: ProficiencyTierMatchType;
  if (candidateIdx > expectedIdx) {
    rawMultiplier = 1 + (candidateIdx - expectedIdx) * BOOST_PER_TIER;
    matchType = 'exceeds';
  } else if (candidateIdx < expectedIdx) {
    rawMultiplier = 1 - (expectedIdx - candidateIdx) * PENALTY_PER_TIER;
    matchType = 'below';
  } else {
    rawMultiplier = 1;
    matchType = 'meets';
  }
  rawMultiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, rawMultiplier));

  const confidence = Math.min(1, Math.max(0, candidateConfidence));
  const multiplier = Number((1 + (rawMultiplier - 1) * confidence).toFixed(4));

  const reasoning =
    matchType === 'meets'
      ? `Candidate proficiency (${candidateTier}) meets the default expectation (${expectedTier}) - neutral multiplier.`
      : `Candidate proficiency (${candidateTier}) ${matchType} the default expectation (${expectedTier}, confidence ${confidence.toFixed(2)}) - multiplier ${multiplier.toFixed(2)}.`;

  return { multiplier, matchType, reasoning };
}

// Multipliers are multiplicative scale factors, so a geometric mean (not arithmetic) is the
// correct way to combine several skills' multipliers into one overall factor. 1.0 (neutral) when
// there are no matched skills to evaluate - never fabricates an effect from nothing.
export function combineSkillMultipliers(multipliers: number[]): number {
  if (multipliers.length === 0) return 1;
  const logSum = multipliers.reduce((sum, m) => sum + Math.log(Math.max(m, 1e-6)), 0);
  return Number(Math.exp(logSum / multipliers.length).toFixed(4));
}

export interface ProficiencyShadowResult {
  proficiencyAdjustedScore: number;
  overallMultiplier: number;
  skillMultipliers: SkillProficiencyMultiplier[];
}

// Orchestration - computes proficiency for the MATCHED skills only (a multiplier is meaningless
// for a skill the candidate doesn't have at all; that's already captured by the base score's own
// missing-skills penalty). Reuses Phase 7's computeCandidateSkillProficiency exactly as-is.
export async function computeProficiencyShadowResult(candidate: Candidate, matchedSkills: string[], baseScore: number): Promise<ProficiencyShadowResult> {
  if (matchedSkills.length === 0) {
    return { proficiencyAdjustedScore: baseScore, overallMultiplier: 1, skillMultipliers: [] };
  }

  const proficiencies = await computeCandidateSkillProficiency(matchedSkills, candidate.resume_summary, candidate.project_entries, candidate.certifications);

  const skillMultipliers: SkillProficiencyMultiplier[] = proficiencies.map((p) => {
    const { multiplier, matchType, reasoning } = calculateProficiencyMultiplier(p.tier, p.confidence);
    return { skillName: p.skillName, multiplier, candidateTier: p.tier, expectedTier: DEFAULT_EXPECTED_TIER, matchType, confidence: p.confidence, reasoning };
  });

  const overallMultiplier = combineSkillMultipliers(skillMultipliers.map((s) => s.multiplier));
  const proficiencyAdjustedScore = Number(Math.min(100, Math.max(0, baseScore * overallMultiplier)).toFixed(2));

  return { proficiencyAdjustedScore, overallMultiplier, skillMultipliers };
}
