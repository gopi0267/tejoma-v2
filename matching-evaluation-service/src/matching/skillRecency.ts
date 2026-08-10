// Ported from the monolith's src/matching/skillRecency.ts - byte-identical logic. See the
// monolith's own module doc for the full grounding note; unchanged here.
import { canonicalizeSkill } from './skillIntelligence.js';
import type { ProjectEntry } from '../types.js';

export const CATEGORY_DECAY_HALF_LIFE_YEARS: Record<string, number> = {
  ai_ml: 1.5,
  frontend_framework: 2,
  backend_framework: 3,
  cloud: 2.5,
  devops: 2.5,
  data_engineering: 3,
  testing: 4,
  tool: 3,
  library: 3,
  operating_system: 4,
  messaging: 4,
  security: 3,
  design: 4,
  programming_language: 5,
  database: 5,
  methodology: 6,
  architecture: 6,
  soft_skill: 8,
  general: 8,
};
const DEFAULT_HALF_LIFE_YEARS = 4;

export type RecencyConfidence = 'known' | 'unknown';

export interface SkillRecency {
  skillName: string;
  lastUsed: string | null;
  totalMentions: number;
  yearsSinceLastUsed: number | null;
  recencyMultiplier: number;
  confidence: RecencyConfidence;
}

export function parseResumeDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(dateStr);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month - 1, 1));
  }
  const yearMatch = /^(\d{4})$/.exec(dateStr);
  if (yearMatch) {
    return new Date(Date.UTC(Number(yearMatch[1]), 0, 1));
  }
  return null;
}

export function recencyMultiplier(yearsSinceLastUsed: number, category: string | null): number {
  const halfLife = (category && CATEGORY_DECAY_HALF_LIFE_YEARS[category]) || DEFAULT_HALF_LIFE_YEARS;
  const years = Math.max(0, yearsSinceLastUsed);
  return Math.pow(0.5, years / halfLife);
}

export function computeSkillRecencyFromProjects(
  skillName: string,
  projectEntries: ProjectEntry[] | null | undefined,
  category: string | null,
  asOf: Date = new Date()
): SkillRecency {
  const normalizedSkill = skillName.trim().toLowerCase();
  const matchingDates: Date[] = [];

  for (const project of projectEntries || []) {
    const techs = (project.technologies || []).map((t) => t.trim().toLowerCase());
    if (!techs.includes(normalizedSkill)) continue;
    const end = parseResumeDate(project.end_date) || parseResumeDate(project.start_date);
    if (end) matchingDates.push(end);
  }

  const totalMentions = (projectEntries || []).filter((p) =>
    (p.technologies || []).some((t) => t.trim().toLowerCase() === normalizedSkill)
  ).length;

  if (matchingDates.length === 0) {
    return {
      skillName, lastUsed: null, totalMentions, yearsSinceLastUsed: null,
      recencyMultiplier: 1.0, confidence: 'unknown',
    };
  }

  const mostRecent = matchingDates.reduce((latest, d) => (d > latest ? d : latest));
  const yearsSinceLastUsed = Math.max(0, (asOf.getTime() - mostRecent.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

  return {
    skillName,
    lastUsed: mostRecent.toISOString().slice(0, 7),
    totalMentions,
    yearsSinceLastUsed: Number(yearsSinceLastUsed.toFixed(2)),
    recencyMultiplier: Number(recencyMultiplier(yearsSinceLastUsed, category).toFixed(4)),
    confidence: 'known',
  };
}

export async function computeCandidateSkillRecency(
  skills: string[],
  projectEntries: ProjectEntry[] | null | undefined,
  asOf: Date = new Date()
): Promise<SkillRecency[]> {
  const results: SkillRecency[] = [];
  for (const skill of skills || []) {
    const node = await canonicalizeSkill(skill);
    results.push(computeSkillRecencyFromProjects(skill, projectEntries, node?.category ?? null, asOf));
  }
  return results;
}
