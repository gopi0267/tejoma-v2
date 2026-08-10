// Ported from the monolith's src/matching/proficiencyWeighting.ts - byte-identical logic. SHADOW
// MODE ONLY - see the monolith's own module doc for the full scope/correction rationale.
import { computeCandidateSkillProficiency } from './skillProficiency.js';
import type { ProficiencyTier } from './skillProficiency.js';
import type { ShadowCandidate, ProficiencyTierMatchType, SkillProficiencyMultiplier } from '../types.js';

const TIER_INDEX: Record<ProficiencyTier, number> = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 };

export const DEFAULT_EXPECTED_TIER: ProficiencyTier = 'intermediate';

const BOOST_PER_TIER = 0.10;
const PENALTY_PER_TIER = 0.15;
const MAX_MULTIPLIER = 1.3;
const MIN_MULTIPLIER = 0.5;

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

export async function computeProficiencyShadowResult(candidate: ShadowCandidate, matchedSkills: string[], baseScore: number): Promise<ProficiencyShadowResult> {
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
