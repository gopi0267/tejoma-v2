// Enterprise AI Matching Architecture, §2.1 - Skill Proficiency Intelligence.
//
// Skill Intelligence (Phase 1) answers "does this candidate have Python" - a boolean. This module
// answers "how deep" - a graded tier (Beginner/Intermediate/Advanced/Expert) plus a confidence,
// inferred from multiple corroborating REAL sources, never from a self-reported level alone (the
// same discipline this codebase already applies everywhere: Unknown Skill Discovery never trusts
// an LLM's own confidence number; Confidence Architecture never trusts the parser's single
// whole-document score as if it applied per-field).
//
// SCOPE, GROUNDED IN WHAT ACTUALLY EXISTS - the architecture doc lists 5 corroborating sources
// for proficiency. Two of them do not exist in this data model and are NOT approximated here:
//   - "Project complexity" (§2.3) - Project Intelligence Graph (this codebase's §2.3) was
//     deliberately scoped to skill decomposition only (explicit + one-hop implied skills), not
//     complexity/scale extraction - see projectIntelligence.ts's own scope-boundary comment. That
//     was a real, considered scope cut, not an oversight; complexity signal is genuinely absent.
//   - "Recruiter feedback" post-interview proficiency ratings - confirmed absent from this schema
//     in Phase 3's audit (no interview/rating table of any kind exists anywhere).
// The three sources actually used below are all real and computable today:
//   1. Responsibility language (verb-strength in resume/project text) - a cheap, real signal, per
//      the architecture doc's own framing ("a strong, cheap first signal").
//   2. Duration and continuity - from §2.2 Skill Recency & Evolution (skillRecency.ts), already built.
//   3. Certifications - candidates.certifications, cross-referenced by substring match against the
//      skill name (an approximation - no formal certification-to-skill mapping table exists to do
//      this precisely, which is itself worth naming rather than pretending precision that isn't there).
//
// NOT WIRED INTO LIVE SCORING THIS PHASE. The architecture doc says proficiency should scale a
// matched skill's contribution in Dynamic Weighting (§3, already live and already used in
// production when a caller opts into `weighting: 'dynamic'` - src/matching/dynamicWeighting.ts).
// Wiring this in would change real (if currently opt-in, likely low-traffic) production scoring
// output for existing dynamic-weighting callers - a live-behavior change, not just new code -
// which this phase is deliberately not authorized to make unprompted. Computed and exposed as a
// real, tested capability; wiring it into computeDynamicSkillScore is the natural next
// integration step for a future phase to take deliberately, not silently.

import type { ProjectEntry } from '../types.js';
import { computeCandidateSkillRecency, type SkillRecency } from './skillRecency.js';

export type ProficiencyTier = 'beginner' | 'intermediate' | 'advanced' | 'expert';
const TIER_LABELS: ProficiencyTier[] = ['beginner', 'intermediate', 'advanced', 'expert'];

export interface SkillProficiency {
  skillName: string;
  tier: ProficiencyTier;
  confidence: number; // 0-1
  evidence: string[]; // human-readable, so a recruiter/reviewer can see exactly why
}

// ==================== RESPONSIBILITY-LANGUAGE VERB-STRENGTH (pure) ====================
// Verb-strength tiers verbatim from the architecture doc: "used X" < "built X" < "architected X"
// < "led migration to X" < "mentored the team on X". A sentence-scoped proximity match (not
// whole-document) - a strong verb elsewhere in a long resume that has nothing to do with this
// specific skill must never inflate this skill's tier.
interface VerbTierDef { tier: number; label: string; keywords: string[] }
const VERB_TIERS: VerbTierDef[] = [
  { tier: 4, label: 'mentored/owned others in it', keywords: ['mentored', 'coached', 'trained the team', 'onboarded', 'owned the', 'established best practices', 'drove adoption'] },
  { tier: 3, label: 'architected/led a significant effort with it', keywords: ['architected', 'led the', 'led migration', 'optimized', 'scaled', 'redesigned', 'spearheaded', 'drove the'] },
  { tier: 2, label: 'built/developed with it', keywords: ['built', 'developed', 'implemented', 'designed', 'created', 'engineered'] },
  { tier: 1, label: 'used it', keywords: ['used', 'worked with', 'utilized', 'leveraged', 'familiar with', 'exposure to'] },
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Returns the tier (0-4; 0 = skill not found in strong-verb context anywhere scanned) of the
// STRONGEST verb found in a sentence that also mentions the skill.
export function strongestVerbTierForSkill(skillName: string, texts: (string | null | undefined)[]): number {
  const skillLower = skillName.trim().toLowerCase();
  if (!skillLower) return 0;
  let strongest = 0;
  for (const text of texts) {
    if (!text) continue;
    for (const sentence of splitSentences(text)) {
      const sentenceLower = sentence.toLowerCase();
      if (!sentenceLower.includes(skillLower)) continue;
      for (const { tier, keywords } of VERB_TIERS) {
        if (tier <= strongest) continue; // already found at least this strong elsewhere
        if (keywords.some((kw) => sentenceLower.includes(kw))) strongest = tier;
      }
    }
  }
  return strongest;
}

export function verbTierLabel(tier: number): string | null {
  return VERB_TIERS.find((v) => v.tier === tier)?.label ?? null;
}

// ==================== SCORING (pure, given already-computed recency) ====================
export function computeSkillProficiency(
  skillName: string,
  resumeText: string | null | undefined,
  projectEntries: ProjectEntry[] | null | undefined,
  certifications: string[] | null | undefined,
  recency: SkillRecency | null
): SkillProficiency {
  const evidence: string[] = [];
  const texts = [resumeText, ...(projectEntries || []).map((p) => p.description)];
  const verbTier = strongestVerbTierForSkill(skillName, texts);
  if (verbTier > 0) evidence.push(`Resume/project text describes having ${verbTierLabel(verbTier)}`);

  let score = verbTier;

  if (recency && recency.confidence === 'known' && recency.totalMentions >= 2) {
    score += 0.5;
    evidence.push(`Appears across ${recency.totalMentions} distinct dated projects, not just one`);
  }

  const skillLower = skillName.trim().toLowerCase();
  const hasCertification = (certifications || []).some((c) => c.toLowerCase().includes(skillLower));
  if (hasCertification) {
    score += 0.5;
    evidence.push('Corroborated by a listed certification mentioning this skill');
  }

  // Corroboration raises confidence in an existing claim - it never manufactures a tier from
  // nothing. If the skill was never found in strong-verb context at all (verbTier === 0), the
  // score is capped low regardless of how much corroboration exists, matching the architecture
  // doc's "uncertainty resolves toward the safer estimate" pattern.
  const cappedScore = verbTier === 0 ? Math.min(score, 1) : score;
  const tierIndex = Math.max(0, Math.min(3, Math.round(cappedScore)));
  const tier = TIER_LABELS[tierIndex];

  const confidence = Math.min(
    1,
    0.3 + (verbTier > 0 ? 0.3 : 0) + (recency?.confidence === 'known' ? 0.2 : 0) + (hasCertification ? 0.2 : 0)
  );

  if (evidence.length === 0) evidence.push('No corroborating evidence found in resume text, project descriptions, or certifications - defaulted to a conservative tier');

  return { skillName, tier, confidence: Number(confidence.toFixed(2)), evidence };
}

// ==================== ORCHESTRATION ====================
export async function computeCandidateSkillProficiency(
  skills: string[],
  resumeText: string | null | undefined,
  projectEntries: ProjectEntry[] | null | undefined,
  certifications: string[] | null | undefined,
  asOf: Date = new Date()
): Promise<SkillProficiency[]> {
  const recencies = await computeCandidateSkillRecency(skills || [], projectEntries, asOf);
  const recencyBySkill = new Map(recencies.map((r) => [r.skillName, r]));
  return (skills || []).map((skill) =>
    computeSkillProficiency(skill, resumeText, projectEntries, certifications, recencyBySkill.get(skill) ?? null)
  );
}
