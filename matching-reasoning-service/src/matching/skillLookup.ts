// Ported from the monolith's src/matching/skillIntelligence.ts - canonicalizeSkill/
// canonicalizeSkills only (byte-identical trivial wrappers around db.findSkillNodeByAlias). The
// rest of skillIntelligence.ts (seeding, cooccurrence computation) is the monolith's writer-side
// logic and stays there - this service never writes skill_nodes/skill_edges itself (see db.ts's
// header comment).
import { db } from '../db.js';
import type { SkillNode } from '../types.js';

export async function canonicalizeSkill(rawSkillText: string): Promise<SkillNode | null> {
  if (!rawSkillText || !rawSkillText.trim()) return null;
  return db.findSkillNodeByAlias(rawSkillText);
}

export async function canonicalizeSkills(rawSkillTexts: string[]): Promise<(SkillNode | null)[]> {
  return Promise.all(rawSkillTexts.map(canonicalizeSkill));
}
