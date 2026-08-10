// Enterprise AI Matching Architecture, Phase 13 - §2.2 Skill Recency Weighting, SHADOW MODE
// ONLY.
//
// Same discipline and reasoning as Phases 11 (proficiencyWeighting.ts) and 12
// (careerWeighting.ts) - computes and shadow-logs what a recency-weighted score WOULD be,
// alongside every real decision. Never applied to a live match score.
//
// Corrections against real data:
//   1. The spec's six-category taxonomy (FRAMEWORK/LANGUAGE/PLATFORM/CONCEPT/TOOL/DOMAIN) with
//      its own boost/decay table doesn't exist and would be a second, disconnected taxonomy next
//      to the one Phase 6 already built and uses in production (skillRecency.ts's
//      CATEGORY_DECAY_HALF_LIFE_YEARS - 19 real skill-dictionary categories, each with its own
//      already-curated decay half-life). This module derives boost/decay coefficients directly
//      FROM that real half-life map (faster-decaying category -> bigger coefficient) instead of
//      inventing a table that could silently drift out of sync with it.
//   2. Confidence isn't a stored number. Phase 6's RecencyConfidence is 'known' | 'unknown', not
//      a 0-1 float - the spec's worked examples (0.92, 0.95, 0.5) assume granularity that was
//      never computed. NUMERIC_CONFIDENCE below is this module's own documented calibration
//      (known + 2+ corroborating mentions -> 0.9; known + 1 mention -> 0.75; unknown/no date ->
//      0.5, matching the spec's own stated value for that specific case).
//   3. No role carries a stored "expects fresh skills" flag. ROLE_RECENCY_EXPECTATION below is a
//      small, explicit, curated mapping from REAL role_profiles.role_key values (from
//      roleIntelligence.ts's ROLE_SEEDS) to an expectation tier - same curation discipline as
//      skillIntelligence.ts's own FRAMEWORK_OF/USES lists. Any job that doesn't resolve to one of
//      these keys defaults to 'medium' (no adjustment) - never guessed.
//   4. The spec's ">60 months: per-category hard floor" table doesn't reduce to any consistent
//      ratio from its own two worked examples (framework: -0.25 decay coefficient -> 0.60 floor;
//      concept: -0.05 decay coefficient -> 0.85 floor - a 6x and 3x drop-to-coefficient ratio
//      respectively, not the same rule). Replaced with a simpler, equally-faithful mechanism: the
//      linear decay ramp continues past 60 months and the same global [0.60, 1.20] clamp already
//      used everywhere else naturally floors it - faster-decaying categories still hit the floor
//      sooner, without a second ad hoc table.
//   5. The 6/36/60-month boost/decay boundary arithmetic in the spec's own worked examples DOES
//      check out exactly this time - implemented faithfully, unlike corrections 1-4 above.

import { db } from '../db.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import { computeCandidateSkillRecency, CATEGORY_DECAY_HALF_LIFE_YEARS } from './skillRecency.js';
import { resolveJobRole } from './careerIntelligence/jobSequence.js';
import { combineSkillMultipliers } from './proficiencyWeighting.js';
import type { Candidate, Job, ProjectEntry, RoleRecencyExpectation, SkillRecencyMultiplier } from '../types.js';

const REFERENCE_HALF_LIFE_YEARS = 4; // same DEFAULT_HALF_LIFE_YEARS skillRecency.ts itself uses for an uncategorized skill
const BASE_BOOST = 0.15;
const BASE_DECAY = 0.2;
const MIN_COEFFICIENT = 0.05;
const MAX_BOOST_COEFFICIENT = 0.25;
const MAX_DECAY_COEFFICIENT = 0.3;

// Derives this category's boost/decay intensity from its real, already-curated half-life
// (shorter half-life = faster-aging category = bigger swing in both directions).
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

// Pure - the 6/36-month piecewise curve from the spec, faithfully implemented (see correction
// #5). Unbounded past 36 months; the caller clamps to [MIN_MULTIPLIER, MAX_MULTIPLIER].
export function rawRecencyMultiplier(monthsSinceUse: number, boostCoefficient: number, decayCoefficient: number): number {
  if (monthsSinceUse < NEUTRAL_BAND_START_MONTHS) {
    return 1 + ((NEUTRAL_BAND_START_MONTHS - monthsSinceUse) / BOOST_WINDOW_MONTHS) * boostCoefficient;
  }
  if (monthsSinceUse <= NEUTRAL_BAND_END_MONTHS) {
    return 1;
  }
  return 1 - ((monthsSinceUse - NEUTRAL_BAND_END_MONTHS) / DECAY_WINDOW_MONTHS) * decayCoefficient;
}

// Curated from roleIntelligence.ts's real ROLE_SEEDS role_key values - see module doc correction
// #3. Anything not listed (including an unresolved role) defaults to 'medium' - no adjustment.
const HIGH_RECENCY_ROLES = new Set(['genai_engineer', 'ml_engineer', 'frontend_engineer', 'devops_engineer']);
const LOW_RECENCY_ROLES = new Set(['backend_engineer', 'data_engineer', 'sap_consultant']);

export function roleRecencyExpectation(roleKey: string | null): RoleRecencyExpectation {
  if (roleKey && HIGH_RECENCY_ROLES.has(roleKey)) return 'high';
  if (roleKey && LOW_RECENCY_ROLES.has(roleKey)) return 'low';
  return 'medium';
}

// Only ever applied to an already-decaying skill (raw < 1) - the spec never defines a boost-side
// role adjustment, only an extra penalty for old skills in fast-moving roles (module doc,
// Decision 3).
const HIGH_EXPECTATION_EXTRA_PENALTY = 0.8;

export function applyRoleAdjustment(rawMultiplier: number, expectation: RoleRecencyExpectation): number {
  if (rawMultiplier >= 1 || expectation !== 'high') return rawMultiplier;
  return Number((rawMultiplier * HIGH_EXPECTATION_EXTRA_PENALTY).toFixed(4));
}

// Unifies confidence interpolation the same way Phases 11/12 do: confidence=0 -> exactly
// neutral, confidence=1 -> full effect.
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

// Orchestration - one multiplier per MATCHED skill (recency is meaningless for a skill the
// candidate doesn't have), combined via the same geometric mean Phase 11 already established for
// combining several skills' multipliers into one.
export async function computeRecencyShadowResult(candidate: Candidate, job: Job, matchedSkills: string[], priorAdjustedScore: number): Promise<RecencyShadowResult> {
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
