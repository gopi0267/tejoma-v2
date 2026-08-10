// Ported from the monolith's src/matching/dynamicWeighting.ts - findLexicalRoleMatch/
// normalizeForLexicalMatch ONLY, byte-identical logic (same narrow slice career-intelligence-
// service ported in Batch 30). Reads this service's own dual-written role_profiles mirror (THIRD
// independent target, Batch 31) via db.getAllRoleProfiles(), not the monolith's table.
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
