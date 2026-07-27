// Enterprise AI Matching Architecture, Phase 2 - Dynamic Weighting Engine.
//
// Replaces the static Jaccard skill score with a tier-weighted, graph-aware one. Two genuinely
// dynamic inputs are implemented this phase, both backed by real data already in the system:
//   - Role (via Phase 1's Role Intelligence): resolveSkillTiers() below.
//   - Seniority (via the job's own stated experience requirement): computeSeniorityAdjustedWeights().
// Industry and "business priorities" from the architecture's §3 table are NOT implemented here -
// there is no reliable industry field or business-priority configuration in this system yet, and
// fabricating either would violate this project's explicit "do not fabricate" discipline.
// "Historical hiring data" needs Phase 3's Feedback Learning Engine, which does not exist yet.
// Both gaps are named here, not hidden.
//
// THIS MODULE DOES NOT RUN BY DEFAULT. It's called only when matchingApi.ts's `weighting:
// 'dynamic'` option is explicitly requested - every existing surface keeps using the static
// 0.40/0.35/0.15/0.10 formula (services.ts's computeFeatureScore, unmodified) unless a caller
// opts in. See matchingApi.ts's module doc for the validation-safe rollback path this enables:
// removing (or never adding) `weighting: 'dynamic'` at any call site is a complete, instant
// rollback to today's exact scoring, with no code change required elsewhere.

import { db } from '../db.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import type { Job, RoleProfile, SkillRelationshipType } from '../types.js';

export type SkillTier = 'mandatory' | 'preferred' | 'optional' | 'bonus';

export interface ResolvedSkillTiers {
  mandatory: string[];
  preferred: string[];
  optional: string[];
  bonus: string[];
  roleMatch: { role: RoleProfile; similarity: number } | null;
}

// ---- Role resolution for tier-filling: lexical match ONLY, embedding similarity NOT trusted ----
//
// Finding from Phase 2 integration testing: matchRoleByTitle's embedding-based similarity is not
// reliable enough to gate automatic tier-filling. The literal, exact title "Backend Engineer"
// matched to the "Frontend Engineer" role profile at 0.687 similarity - a confident-looking score
// for the wrong role. Because the mis-score is this large, no confidence threshold fixes it (0.687
// would clear almost any reasonable bar); the problem is that this signal doesn't reliably track
// correctness for short-title-vs-long-document comparisons with the current embedding model, not
// that the threshold was mis-tuned.
//
// Resolution (discussed and approved): role-based tier-filling now requires a LEXICAL match - the
// JD title must literally contain (or equal) a known role's display name, normalized for casing/
// punctuation - before any role-profile defaults are applied at all. matchRoleByTitle/embedding
// similarity is not used for this decision. This is intentionally conservative: precision over
// recall, and a real (if narrower) capability, not a fabricated one. Improving recall - e.g. via a
// dedicated title-only embedding facet compared against a title-only role representation, instead
// of title-vs-long-aggregated-document - is future work, not attempted here under time pressure.
export function normalizeForLexicalMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Exported for reuse by §2.4 Career Intelligence (src/matching/careerIntelligence/jobSequence.ts),
// which needs the exact same "resolve a free-text title to a role_profiles row" primitive to map
// a work_history entry's title onto Role Intelligence - reusing this rather than writing new
// title-matching logic avoids reintroducing the embedding-similarity bug this function was built
// to fix (see this module's own doc comment above).
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

// JD-explicit skills ALWAYS take precedence over role-profile defaults - role-inferred
// requirements only fill gaps the JD itself didn't state, and always land at a LOWER tier than an
// explicit JD statement would (matches the architecture document's own §2 principle: "an
// incomplete JD should widen the candidate pool it reaches, not narrow it based on a guess").
export async function resolveSkillTiers(job: Job): Promise<ResolvedSkillTiers> {
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
      roleMatch = { role, similarity: 1 }; // lexical match, not an embedding score - 1 signals "exact/contained", not a graded confidence

      // role.mandatory_skills fill gaps at 'preferred' (one tier below an explicit JD statement).
      for (const skill of role.mandatory_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        preferred.push(skill);
        seen.add(skill.toLowerCase());
      }
      // role.preferred_skills fill gaps at 'optional'.
      for (const skill of role.preferred_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        optional.push(skill);
        seen.add(skill.toLowerCase());
      }
      // role.optional_skills fill gaps at 'bonus'.
      for (const skill of role.optional_skills) {
        if (seen.has(skill.toLowerCase())) continue;
        bonus.push(skill);
        seen.add(skill.toLowerCase());
      }
    }
  }

  return { mandatory, preferred, optional, bonus, roleMatch };
}

// ==================== SENIORITY-ADJUSTED TOP-LEVEL WEIGHTS ====================

export interface DynamicWeights {
  skillWeight: number;
  experienceWeight: number;
  locationWeight: number;
  salaryWeight: number;
  seniorityNote: string | null;
}

// The existing static formula's weights - the floor/default this function adjusts away from, so
// a job with no usable experience signal produces IDENTICAL weights to today's formula.
const BASE_WEIGHTS = { skill: 0.40, experience: 0.35, location: 0.15, salary: 0.10 };
const MAX_SENIORITY_SHIFT = 0.05; // bounded - never more than 5 percentage points moved

// A senior/staff-level posting should weight depth of experience somewhat more, and breadth of
// skill-matching somewhat less, than a junior one - bounded, monotonic in required experience,
// and reduces to BASE_WEIGHTS exactly when no experience requirement is stated.
export function computeSeniorityAdjustedWeights(job: Job): DynamicWeights {
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

// ==================== TIER-WEIGHTED, GRAPH-AWARE SKILL SCORE ====================

export interface SkillMatchOutcome {
  requiredSkill: string;
  tier: SkillTier;
  matchType: 'exact' | 'graph_related';
  matchedCandidateSkill: string;
  relationshipType?: SkillRelationshipType;
}

export interface DynamicSkillScoreResult {
  score: number; // 0-100
  matched: SkillMatchOutcome[];
  missingMandatory: string[];
  missingOther: string[]; // missing preferred/optional/bonus, lower priority than missingMandatory
}

// How much each tier contributes to the overall skill score - mandatory dominant, bonus barely
// moves the needle. Sums to 1.0; tiers with zero required skills simply don't participate (their
// weight is excluded from the normalization denominator, not treated as 0% match).
export const TIER_WEIGHTS: Record<SkillTier, number> = { mandatory: 0.50, preferred: 0.30, optional: 0.15, bonus: 0.05 };
// Partial credit for a graph-related (not exact) match - meaningfully less than a real match, but
// not zero, matching the architecture's "partial credit for adjacent skills" design.
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

  // No skills required in any tier at all (an essentially empty JD) - neutral 100, matching the
  // existing "no data = don't penalize" convention already used for salScore when no salary data
  // exists (services.ts).
  const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 100;

  return { score, matched, missingMandatory, missingOther };
}
