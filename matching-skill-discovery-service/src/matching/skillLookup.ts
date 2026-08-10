// Ported from the monolith's src/matching/skillIntelligence.ts - canonicalizeSkill/
// canonicalizeSkills (byte-identical trivial wrappers around db.findSkillNodeByAlias) plus
// CATEGORY_TO_DOMAIN/domainFor (the pure lookup table unknownSkillDiscovery.ts's promoteToSkillNode
// needs). The rest of skillIntelligence.ts (seeding, cooccurrence computation) is the monolith's
// writer-side logic and stays there - this service never writes skill_nodes/skill_edges itself
// (see db.ts's header comment).
import { db } from '../db.js';
import type { SkillNode } from '../types.js';

export async function canonicalizeSkill(rawSkillText: string): Promise<SkillNode | null> {
  if (!rawSkillText || !rawSkillText.trim()) return null;
  return db.findSkillNodeByAlias(rawSkillText);
}

export async function canonicalizeSkills(rawSkillTexts: string[]): Promise<(SkillNode | null)[]> {
  return Promise.all(rawSkillTexts.map(canonicalizeSkill));
}

// Broader groupings than the dictionary's 19 categories - each becomes one synthetic domain node,
// PARENT_OF every skill whose category maps here. Byte-identical to the monolith's own copy.
export const CATEGORY_TO_DOMAIN: Record<string, string> = {
  programming_language: 'Programming Languages',
  frontend_framework: 'Web Development',
  backend_framework: 'Web Development',
  database: 'Data & Storage',
  cloud: 'Cloud & Infrastructure',
  devops: 'Cloud & Infrastructure',
  ai_ml: 'AI & Data Science',
  data_engineering: 'AI & Data Science',
  testing: 'Quality Engineering',
  operating_system: 'Systems & Platforms',
  messaging: 'Systems & Platforms',
  tool: 'Developer Tooling',
  library: 'Developer Tooling',
  methodology: 'Process & Architecture',
  architecture: 'Process & Architecture',
  security: 'Security',
  design: 'Design',
  soft_skill: 'Professional Skills',
  general: 'Professional Skills',
};

export function domainFor(category: string): string | null {
  return CATEGORY_TO_DOMAIN[category] ?? null;
}
