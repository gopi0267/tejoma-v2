// Ported from the monolith's src/matching/dynamicWeighting.ts - findLexicalRoleMatch/
// normalizeForLexicalMatch ONLY, byte-identical logic. The monolith's own dynamicWeighting.ts has
// a much larger scoring surface (resolveSkillTiers etc.) that is dormant on the live path and out
// of scope for this batch (see Batch 33's plan) - only the two lexical-title-matching primitives
// that jobSequence.ts/futureRolePrediction.ts genuinely need at runtime are ported here.
//
// Reads this service's own dual-written role_profiles mirror via db.getAllRoleProfiles(), not the
// monolith's table.
import { db } from '../db.js';
import type { RoleProfile } from '../types.js';

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
