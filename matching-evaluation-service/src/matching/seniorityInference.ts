/**
 * Duplicated (not shared) from the monolith's src/matching/careerIntelligence/jobSequence.ts -
 * `inferSeniority` (Batch 25) plus, as of Batch 31, `isManagementTitle`/`SENIORITY_ORDER`/
 * `resolveJobRole` too - careerWeighting.ts/recencyWeighting.ts both need the exact same
 * title-resolution primitives Batch 25's shadowDataHealth.ts already needed a copy of.
 * `resolveJobRole` additionally needs findLexicalRoleMatch/normalizeForLexicalMatch - unlike
 * Batch 25's reasoning for keeping this file narrow (avoiding dynamicWeighting.ts's much larger,
 * dormant scoring surface), Batch 31 already has its own narrow port of exactly those two
 * functions (./dynamicWeighting.ts, reading this service's own role_profiles mirror) - so pulling
 * them in here reintroduces no dormant-code coupling.
 */
import { findLexicalRoleMatch, normalizeForLexicalMatch } from './dynamicWeighting.js';

export type SeniorityLevel = 'entry' | 'mid' | 'senior' | 'staff' | 'principal' | 'manager' | 'director' | 'unknown';

export const SENIORITY_ORDER: SeniorityLevel[] = ['entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director'];

const SENIORITY_KEYWORDS: { level: SeniorityLevel; pattern: RegExp }[] = [
  { level: 'director', pattern: /\bdirector\b|\bvice president\b|\bvp\b/i },
  { level: 'principal', pattern: /\bprincipal\b/i },
  { level: 'staff', pattern: /\bstaff\b/i },
  { level: 'manager', pattern: /\bmanager\b|\bhead of\b/i },
  { level: 'senior', pattern: /\bsenior\b|\bsr\.?\s|\blead\b/i },
  { level: 'entry', pattern: /\bjunior\b|\bjr\.?\s|\bentry.level\b|\bassociate\b|\bintern\b/i },
];

// A bare title with no seniority keyword (e.g. plain "Backend Engineer") defaults to 'mid' at
// reduced confidence - matches the monolith's original exactly.
export function inferSeniority(title: string | null | undefined): { level: SeniorityLevel; confidence: number } {
  if (!title || !title.trim()) return { level: 'unknown', confidence: 0 };
  for (const { level, pattern } of SENIORITY_KEYWORDS) {
    if (pattern.test(title)) return { level, confidence: 0.7 };
  }
  return { level: 'mid', confidence: 0.4 };
}

export function isManagementTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /\bmanager\b|\bdirector\b|\bvp\b|\bvice president\b|\bhead of\b|\bchief\b/i.test(title);
}

// Byte-identical to the monolith's jobSequence.ts's own resolveJobRole - resolves a free-text
// title to a Role Intelligence role and a "domain" bucket, falling back to a normalized version of
// the raw title itself when no confident lexical match exists (roleProfileId stays null).
export async function resolveJobRole(title: string | null | undefined): Promise<{ roleProfileId: number | null; domain: string | null }> {
  if (!title || !title.trim()) return { roleProfileId: null, domain: null };
  const role = await findLexicalRoleMatch(title);
  if (role) return { roleProfileId: role.id, domain: role.role_key };
  return { roleProfileId: null, domain: normalizeForLexicalMatch(title) || null };
}
