// Enterprise AI Matching Architecture, §2.2 - Skill Recency & Evolution Intelligence.
//
// The Skill Intelligence Platform (Phase 1) already tracks PLATFORM-WIDE evolution (a skill's
// overall popularity trend). This module tracks the same idea at the INDIVIDUAL candidate level:
// not just whether a candidate has a skill, but when they last used it.
//
// GROUNDING NOTE - why this reads project_entries, not work_history: work_history (Phase 5
// prerequisite) has real dates but NO skill association at all (a resume doesn't say "I used
// Python from 2020-2022" as one fact - it says "I worked at Acme 2020-2022" and separately lists
// skills). project_entries is the ONLY place in the current data model where a skill and a date
// can be honestly associated together (a project's technologies[] list alongside its own
// start_date/end_date). A skill that never appears in any project_entries technologies list has
// NO honest basis for a recency claim here - this module reports that as "unknown", never as a
// guessed default (the same "no data = don't penalize, don't fabricate" convention already used
// throughout this codebase, e.g. services.ts's salScore).
//
// NOT IMPLEMENTED THIS PHASE, NAMED RATHER THAN HIDDEN:
//   - "Currency bonus for early adoption" (architecture doc §2.2) explicitly depends on Labor
//     Market Intelligence's (§2.5) adoption-curve data, which does not exist yet.
//   - "Recency acts as a multiplier on the Proficiency score (§2.1)" - §2.1 (Skill Proficiency
//     Intelligence) does not exist yet either, so there is nothing to multiply against. This
//     module computes and exposes the recency signal as a real, callable capability; wiring it
//     into live match scoring is deferred to whichever future phase builds §2.1, matching this
//     project's established tiered-rollout pattern (compute and expose, wire in later, once the
//     thing it composes with actually exists).

import { canonicalizeSkill } from './skillIntelligence.js';
import type { ProjectEntry } from '../types.js';

// Decay half-life in years, by Skill Intelligence category (src/jd-parser/dictionaries/
// skills.dictionary.ts's own category taxonomy - the same categories every skill_node already
// carries). Fast-decaying for rapidly-evolving categories, slow for stable fundamentals, per the
// architecture doc's own examples. A modeling parameter (like dynamicWeighting.ts's TIER_WEIGHTS),
// not a fabricated fact - explicitly documented and tunable, not derived from any dataset.
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
const DEFAULT_HALF_LIFE_YEARS = 4; // unknown/uncategorized skill - a middling, conservative default

export type RecencyConfidence = 'known' | 'unknown';

export interface SkillRecency {
  skillName: string;
  lastUsed: string | null; // the raw "YYYY-MM"/"YYYY" string, for display
  totalMentions: number; // count of distinct project_entries this skill was found in with a usable date
  yearsSinceLastUsed: number | null;
  recencyMultiplier: number; // 0-1, 1.0 when unknown (never penalize absence of evidence)
  confidence: RecencyConfidence;
}

// ==================== DATE PARSING (pure) ====================
// Parses this module's own "YYYY-MM" | "YYYY" format (the exact format parser.service.ts's
// normalizeDateField already validates and stores - see migration-phase5-structured-history.sql).
// Returns a comparable Date (first of the month, or Jan 1 for year-only) or null for anything else.
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

// ==================== DECAY CURVE (pure) ====================
// Smooth exponential decay, never a hard cutoff, per the architecture doc: multiplier = 0.5 ^
// (years-since-last-used / half-life). 1.0 at zero years elapsed, 0.5 at exactly one half-life,
// asymptotically approaching (never reaching) 0 - a skill is never treated as fully "gone".
//
// Deliberately measured against real-world "now" (not the resume's own latest-mentioned-year,
// unlike parser.service.ts's years-of-experience calculation) - recency-for-matching answers "how
// current is this skill as of today, for a job open today", a different question from "how much
// experience had this candidate accumulated when they wrote this document". An unrefreshed old
// resume genuinely should read as less current today; that's the real signal this multiplier
// exists to capture, not an artifact to correct for.
export function recencyMultiplier(yearsSinceLastUsed: number, category: string | null): number {
  const halfLife = (category && CATEGORY_DECAY_HALF_LIFE_YEARS[category]) || DEFAULT_HALF_LIFE_YEARS;
  const years = Math.max(0, yearsSinceLastUsed);
  return Math.pow(0.5, years / halfLife);
}

// ==================== PER-SKILL RECENCY FROM PROJECT ENTRIES (pure, given a category resolver) ====================
// asOf defaults to real-world now (see recencyMultiplier's doc); injectable for deterministic
// testing.
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
    // A project mentioning this skill counts as a "mention" for frequency purposes even when it
    // has no usable date; only dated projects contribute to lastUsed/decay.
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
    lastUsed: mostRecent.toISOString().slice(0, 7), // back to "YYYY-MM" for display
    totalMentions,
    yearsSinceLastUsed: Number(yearsSinceLastUsed.toFixed(2)),
    recencyMultiplier: Number(recencyMultiplier(yearsSinceLastUsed, category).toFixed(4)),
    confidence: 'known',
  };
}

// ==================== ORCHESTRATION (needs Skill Intelligence for category lookup) ====================
// One canonicalizeSkill() call per skill - candidate.skills lists are typically small (tens, not
// hundreds), so this stays cheap; not on any hot request path this phase (see module doc).
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
