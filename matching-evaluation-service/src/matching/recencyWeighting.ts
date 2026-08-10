// Ported from the monolith's src/matching/recencyWeighting.ts - byte-identical logic. SHADOW MODE
// ONLY - see the monolith's own module doc for the full correction rationale.
import { canonicalizeSkill } from './skillIntelligence.js';
import { computeCandidateSkillRecency, CATEGORY_DECAY_HALF_LIFE_YEARS } from './skillRecency.js';
import { resolveJobRole } from './seniorityInference.js';
import { combineSkillMultipliers } from './proficiencyWeighting.js';
import type { ShadowCandidate, ShadowJob, ProjectEntry, RoleRecencyExpectation, SkillRecencyMultiplier } from '../types.js';

const REFERENCE_HALF_LIFE_YEARS = 4;
const BASE_BOOST = 0.15;
const BASE_DECAY = 0.2;
const MIN_COEFFICIENT = 0.05;
const MAX_BOOST_COEFFICIENT = 0.25;
const MAX_DECAY_COEFFICIENT = 0.3;

function coefficientsForCategory(category: string | null): { boost: number; decay: number } {
  const halfLife = (category && CATEGORY_DECAY_HALF_LIFE_YEARS[category]) || REFERENCE_HALF_LIFE_YEARS;
  const intensity = REFERENCE_HALF_LIFE_YEARS / halfLife;
  return {
    boost: Number(Math.max(MIN_COEFFICIENT, Math.min(MAX_BOOST_COEFFICIENT, BASE_BOOST * intensity)).toFixed(4)),
    decay: Number(Math.max(MIN_COEFFICIENT, Math.min(MAX_DECAY_COEFFICIENT, BASE_DECAY * intensity)).toFixed(4)),
  };
}

const NEUTRAL_BAND_START_MONTHS = 6;
const NEUTRAL_BAND_END_MONTHS = 36;
const BOOST_WINDOW_MONTHS = 12;
const DECAY_WINDOW_MONTHS = 24;
const MAX_MULTIPLIER = 1.2;
const MIN_MULTIPLIER = 0.6;

export function rawRecencyMultiplier(monthsSinceUse: number, boostCoefficient: number, decayCoefficient: number): number {
  if (monthsSinceUse < NEUTRAL_BAND_START_MONTHS) {
    return 1 + ((NEUTRAL_BAND_START_MONTHS - monthsSinceUse) / BOOST_WINDOW_MONTHS) * boostCoefficient;
  }
  if (monthsSinceUse <= NEUTRAL_BAND_END_MONTHS) {
    return 1;
  }
  return 1 - ((monthsSinceUse - NEUTRAL_BAND_END_MONTHS) / DECAY_WINDOW_MONTHS) * decayCoefficient;
}

const HIGH_RECENCY_ROLES = new Set(['genai_engineer', 'ml_engineer', 'frontend_engineer', 'devops_engineer']);
const LOW_RECENCY_ROLES = new Set(['backend_engineer', 'data_engineer', 'sap_consultant']);

export function roleRecencyExpectation(roleKey: string | null): RoleRecencyExpectation {
  if (roleKey && HIGH_RECENCY_ROLES.has(roleKey)) return 'high';
  if (roleKey && LOW_RECENCY_ROLES.has(roleKey)) return 'low';
  return 'medium';
}

const HIGH_EXPECTATION_EXTRA_PENALTY = 0.8;

export function applyRoleAdjustment(rawMultiplier: number, expectation: RoleRecencyExpectation): number {
  if (rawMultiplier >= 1 || expectation !== 'high') return rawMultiplier;
  return Number((rawMultiplier * HIGH_EXPECTATION_EXTRA_PENALTY).toFixed(4));
}

export function calculateSkillRecencyMultiplier(
  monthsSinceUse: number | null,
  category: string | null,
  confidence: number,
  expectation: RoleRecencyExpectation
): { multiplier: number; reasoning: string } {
  if (monthsSinceUse === null) {
    return { multiplier: 1, reasoning: 'Usage date unknown - treated as neutral, no boost or penalty.' };
  }

  const { boost, decay } = coefficientsForCategory(category);
  const raw = rawRecencyMultiplier(monthsSinceUse, boost, decay);
  const adjusted = applyRoleAdjustment(raw, expectation);
  const capped = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, adjusted));
  const c = Math.min(1, Math.max(0, confidence));
  const multiplier = Number((1 + (capped - 1) * c).toFixed(4));

  const reasoning =
    multiplier > 1.01
      ? `Used ${monthsSinceUse.toFixed(0)} months ago (${category ?? 'uncategorized'}) - recent, multiplier ${multiplier.toFixed(2)}.`
      : multiplier < 0.99
        ? `Used ${monthsSinceUse.toFixed(0)} months ago (${category ?? 'uncategorized'})${expectation === 'high' ? ', role expects fresh skills' : ''} - aging, multiplier ${multiplier.toFixed(2)}.`
        : `Used ${monthsSinceUse.toFixed(0)} months ago - within the current window, neutral.`;

  return { multiplier, reasoning };
}

export interface RecencyShadowResult {
  recencyAdjustedScore: number;
  overallMultiplier: number;
  skillMultipliers: SkillRecencyMultiplier[];
  roleExpectation: RoleRecencyExpectation;
}

export async function computeRecencyShadowResult(candidate: ShadowCandidate, job: ShadowJob, matchedSkills: string[], priorAdjustedScore: number): Promise<RecencyShadowResult> {
  const jobRole = await resolveJobRole(job.title);
  const roleExpectation = roleRecencyExpectation(jobRole.roleProfileId !== null ? jobRole.domain : null);

  if (matchedSkills.length === 0) {
    return { recencyAdjustedScore: priorAdjustedScore, overallMultiplier: 1, skillMultipliers: [], roleExpectation };
  }

  const [recencies, categorizedSkills] = await Promise.all([
    computeCandidateSkillRecency(matchedSkills, (candidate.project_entries as ProjectEntry[] | null) ?? null),
    Promise.all(matchedSkills.map((s) => canonicalizeSkill(s))),
  ]);
  const categoryBySkill = new Map(matchedSkills.map((s, i) => [s.toLowerCase().trim(), categorizedSkills[i]?.category ?? null]));

  const skillMultipliers: SkillRecencyMultiplier[] = recencies.map((r) => {
    const category = categoryBySkill.get(r.skillName.toLowerCase().trim()) ?? null;
    const monthsSinceUse = r.confidence === 'known' && r.yearsSinceLastUsed !== null ? r.yearsSinceLastUsed * 12 : null;
    const confidence = monthsSinceUse === null ? 0.5 : r.totalMentions >= 2 ? 0.9 : 0.75;
    const { multiplier, reasoning } = calculateSkillRecencyMultiplier(monthsSinceUse, category, confidence, roleExpectation);
    return { skillName: r.skillName, multiplier, monthsSinceUse, skillCategory: category, confidence, reasoning };
  });

  const overallMultiplier = combineSkillMultipliers(skillMultipliers.map((s) => s.multiplier));
  const recencyAdjustedScore = Number(Math.min(100, Math.max(0, priorAdjustedScore * overallMultiplier)).toFixed(2));

  return { recencyAdjustedScore, overallMultiplier, skillMultipliers, roleExpectation };
}
