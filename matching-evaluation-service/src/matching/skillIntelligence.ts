// Ported from the monolith's src/matching/skillIntelligence.ts - canonicalizeSkill only,
// byte-identical logic. Reads this service's own dual-written skill_nodes mirror (THIRD
// independent target, Batch 31), not the monolith's table.
import { db } from '../db.js';
import type { SkillNode } from '../types.js';

export async function canonicalizeSkill(rawSkillText: string): Promise<SkillNode | null> {
  if (!rawSkillText || !rawSkillText.trim()) return null;
  return db.findSkillNodeByAlias(rawSkillText);
}
