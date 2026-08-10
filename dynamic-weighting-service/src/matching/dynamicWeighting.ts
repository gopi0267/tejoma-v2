// Ported from the monolith's src/matching/dynamicWeighting.ts - resolveSkillTiers,
// computeSeniorityAdjustedWeights, computeDynamicSkillScore, findLexicalRoleMatch,
// normalizeForLexicalMatch - byte-identical logic. Confirmed dormant on the monolith's live path:
// only reachable via matchingApi.ts's `weighting: 'dynamic'` option, which no real caller anywhere
// in the repository ever sets (grep -rln "'dynamic'" src scripts returns only the files that
// DEFINE the option, never one that sets it).
//
// Uses this service's own narrowed DynamicWeightingJob type instead of the monolith's full Job -
// only the fields these functions actually read.
import { db } from '../db.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import type { DynamicWeightingJob, RoleProfile, SkillRelationshipType, SkillTier, ResolvedSkillTiers, DynamicWeights, DynamicSkillScoreResult, SkillMatchOutcome } from '../types.js';

export function normalizeForLexicalMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function findLexicalRoleMatch(jobTitle: string): Promise<RoleProfile | null> {
  const normalizedTitle = normalizeForLexicalMatch(jobTitle);
  if (!normalizedTitle) return null;
  const roles = await db.getAllRoleProfiles();
  for (const role of roles) {
    const normalizedRoleName = normalizeForLexicalMatch(role.display_name);
    if (normalizedTitle === normalizedRoleName || normalizedTitle.includes(normalizedRoleName)) {
      return role;
    }
  }
  return null;
}

export async function resolveSkillTiers(job: DynamicWeightingJob): Promise<ResolvedSkillTiers> {
  const mandatory = [...(job.required_skills || [])];
  const jdOptional = job.optional_skills || [];

  const seen = new Set(mandatory.map((s) => s.toLowerCase()));
  const preferred: string[] = [];
  for (const skill of jdOptional) {
    if (seen.has(skill.toLowerCase())) continue;
    preferred.push(skill);
    seen.add(skill.toLowerCase());
  }

  const optional: string[] = [];
  const bonus: string[] = [];
  let roleMatch: { role: RoleProfile; similarity: number } | null = null;

  if (job.title && job.title.trim()) {
    const role = await findLexicalRoleMatch(job.title);
    if (role) {
      roleMatch = { role, similarity: 1 };

      for (const skill of role.mandatory_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        preferred.push(skill);
        seen.add(skill.toLowerCase());
      }
      for (const skill of role.preferred_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        optional.push(skill);
        seen.add(skill.toLowerCase());
      }
      for (const skill of role.optional_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        bonus.push(skill);
        seen.add(skill.toLowerCase());
      }
    }
  }

  return { mandatory, preferred, optional, bonus, roleMatch };
}

const BASE_WEIGHTS = { skill: 0.40, experience: 0.35, location: 0.15, salary: 0.10 };
const MAX_SENIORITY_SHIFT = 0.05;

export function computeSeniorityAdjustedWeights(job: DynamicWeightingJob): DynamicWeights {
  const requiredExp = job.min_experience ?? job.experience_years ?? null;
  if (requiredExp === null || requiredExp === undefined || requiredExp <= 0) {
    return { skillWeight: BASE_WEIGHTS.skill, experienceWeight: BASE_WEIGHTS.experience, locationWeight: BASE_WEIGHTS.location, salaryWeight: BASE_WEIGHTS.salary, seniorityNote: null };
  }
  const shift = Number((Math.min(1, requiredExp / 10) * MAX_SENIORITY_SHIFT).toFixed(4));
  return {
    skillWeight: Number((BASE_WEIGHTS.skill - shift).toFixed(4)),
    experienceWeight: Number((BASE_WEIGHTS.experience + shift).toFixed(4)),
    locationWeight: BASE_WEIGHTS.location,
    salaryWeight: BASE_WEIGHTS.salary,
    seniorityNote: shift > 0
      ? `Required experience (${requiredExp}+ yrs) shifted ${(shift * 100).toFixed(1)} percentage points of weight from skills to experience depth`
      : null,
  };
}

export const TIER_WEIGHTS: Record<SkillTier, number> = { mandatory: 0.50, preferred: 0.30, optional: 0.15, bonus: 0.05 };
const GRAPH_MATCH_CREDIT = 0.6;
const GRAPH_RELATIONSHIP_TYPES: SkillRelationshipType[] = ['RELATED_TO', 'FRAMEWORK_OF', 'COMMONLY_WITH'];

async function findGraphRelatedMatch(requiredSkill: string, candidateSkillsLower: Set<string>): Promise<{ matchedCandidateSkill: string; relationshipType: SkillRelationshipType } | null> {
  const node = await canonicalizeSkill(requiredSkill);
  if (!node) return null;
  for (const relationshipType of GRAPH_RELATIONSHIP_TYPES) {
    const edges = await db.getSkillEdgesFrom(node.id, relationshipType);
    for (const edge of edges) {
      const neighbor = await db.getSkillNodeById(edge.to_skill_id);
      if (!neighbor) continue;
      if (candidateSkillsLower.has(neighbor.canonical_name.toLowerCase()) || neighbor.aliases.some((a) => candidateSkillsLower.has(a.toLowerCase()))) {
        return { matchedCandidateSkill: neighbor.canonical_name, relationshipType };
      }
    }
  }
  return null;
}

export async function computeDynamicSkillScore(candidateSkills: string[], tiers: ResolvedSkillTiers): Promise<DynamicSkillScoreResult> {
  const candidateSkillsLower = new Set((candidateSkills || []).map((s) => s.toLowerCase()));
  const tierLists: Record<SkillTier, string[]> = { mandatory: tiers.mandatory, preferred: tiers.preferred, optional: tiers.optional, bonus: tiers.bonus };

  const matched: SkillMatchOutcome[] = [];
  const missingMandatory: string[] = [];
  const missingOther: string[] = [];

  let weightedSum = 0;
  let weightTotal = 0;

  for (const tier of Object.keys(tierLists) as SkillTier[]) {
    const skills = tierLists[tier];
    if (skills.length === 0) continue;

    let tierMatchSum = 0;
    for (const requiredSkill of skills) {
      if (candidateSkillsLower.has(requiredSkill.toLowerCase())) {
        tierMatchSum += 1;
        matched.push({ requiredSkill, tier, matchType: 'exact', matchedCandidateSkill: requiredSkill });
        continue;
      }
      const graphMatch = await findGraphRelatedMatch(requiredSkill, candidateSkillsLower);
      if (graphMatch) {
        tierMatchSum += GRAPH_MATCH_CREDIT;
        matched.push({ requiredSkill, tier, matchType: 'graph_related', matchedCandidateSkill: graphMatch.matchedCandidateSkill, relationshipType: graphMatch.relationshipType });
      } else if (tier === 'mandatory') {
        missingMandatory.push(requiredSkill);
      } else {
        missingOther.push(requiredSkill);
      }
    }

    const tierRatio = Math.min(1, tierMatchSum / skills.length);
    weightedSum += tierRatio * TIER_WEIGHTS[tier];
    weightTotal += TIER_WEIGHTS[tier];
  }

  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 100;

  return { score, matched, missingMandatory, missingOther };
}
