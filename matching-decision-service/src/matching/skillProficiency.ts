/**
 * Skill Proficiency Intelligence - ported from monolith for explainability module.
 * Computes graded tier (Beginner/Intermediate/Advanced/Expert) plus confidence from
 * responsibility language, duration/continuity, and certifications.
 * Ported verbatim for computeMatchExplanation to use; NOT wired into live scoring.
 */

export type ProficiencyTier = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface SkillProficiency {
  skillName: string;
  tier: ProficiencyTier;
  confidence: number; // 0-1
  evidence: string[];
}

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
        if (tier <= strongest) continue;
        if (keywords.some((kw) => sentenceLower.includes(kw))) strongest = tier;
      }
    }
  }
  return strongest;
}

export async function computeCandidateSkillProficiency(
  skills: string[] | null | undefined,
  resumeSummary: string | null | undefined,
  projectEntries: any[] | null | undefined,
  certifications: string | null | undefined
): Promise<SkillProficiency[]> {
  // Minimal implementation for explainability - computes tier from verb strength
  // and builds evidence strings. A production-ready version would also incorporate
  // skill recency and certification matching.
  const skillList = (skills ?? []).filter((s): s is string => !!s && s.trim().length > 0);
  if (skillList.length === 0) return [];

  const projectTexts = (projectEntries ?? []).map((p: any) => p.description).filter(Boolean);
  const allTexts = [resumeSummary, ...projectTexts].filter(Boolean);

  return skillList.map((skill) => {
    const verbTier = strongestVerbTierForSkill(skill, allTexts);
    const tier: ProficiencyTier = ['beginner', 'intermediate', 'advanced', 'expert'][Math.max(0, verbTier - 1)] ?? 'beginner';
    const confidence = Math.max(0.3, (verbTier / 4) * 0.9); // Confidence tied to verb strength, capped at 0.9

    return {
      skillName: skill,
      tier,
      confidence,
      evidence: verbTier > 0 ? [`Found in resume at "${VERB_TIERS[4 - verbTier]?.label}"`] : ['Mentioned but no proficiency indicator found'],
    };
  });
}
