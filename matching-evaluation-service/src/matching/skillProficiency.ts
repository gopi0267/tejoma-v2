// Ported from the monolith's src/matching/skillProficiency.ts - byte-identical logic.
import type { ProjectEntry } from '../types.js';
import { computeCandidateSkillRecency, type SkillRecency } from './skillRecency.js';

export type ProficiencyTier = 'beginner' | 'intermediate' | 'advanced' | 'expert';
const TIER_LABELS: ProficiencyTier[] = ['beginner', 'intermediate', 'advanced', 'expert'];

export interface SkillProficiency {
  skillName: string;
  tier: ProficiencyTier;
  confidence: number;
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

export function verbTierLabel(tier: number): string | null {
  return VERB_TIERS.find((v) => v.tier === tier)?.label ?? null;
}

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
