// Enterprise AI Matching Architecture, §2.4 Career Intelligence Platform - Module 1: Job Sequence
// Normalization.
//
// Turns candidates.work_history (Phase 5 - a flat, dated list of {company, title, start_date,
// end_date, is_current}) into a normalized, ordered sequence with inferred seniority and a
// resolved domain per role. Every later module in this platform (progression, stability,
// embedding, prediction) builds on this module's output, not on work_history directly.
//
// SENIORITY INFERENCE - "never trust title alone": a title's seniority keyword is a real, cheap
// first signal (this codebase already uses exactly this "responsibility/title language is a
// cheap first signal" pattern for Skill Proficiency, §2.1). It is cross-checked against tenure:
// an elevated title (senior and above) held for a very short, verifiable duration gets a reduced
// confidence, not a rejected inference - matching the "uncertainty resolves toward the safer
// estimate" pattern already applied everywhere else in this codebase, never a hard rejection.
//
// ROLE RESOLUTION - reuses dynamicWeighting.ts's findLexicalRoleMatch/normalizeForLexicalMatch,
// the exact fix Phase 2 built after proving embedding-similarity title matching unreliable
// ("Backend Engineer" matched "Frontend Engineer" at 0.687 similarity). Writing new
// embedding-based title matching here would risk reintroducing that exact bug.

import { findLexicalRoleMatch, normalizeForLexicalMatch } from '../dynamicWeighting.js';
import { parseResumeDate } from '../skillRecency.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedJob, SeniorityLevel, WorkHistoryEntry } from '../../types.js';

// Numeric "how far up the ladder" ordering used for tenure-based comparisons within this module
// (e.g. "did seniority increase"). This is a rough proxy, not a claim that a Manager numerically
// outranks a Principal in every organization - src/matching/careerIntelligence/progression.ts
// determines IC-vs-management TRACK independently of this ordering, specifically because the two
// tracks aren't really comparable on one linear scale.
export const SENIORITY_ORDER: SeniorityLevel[] = ['entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director'];

const SENIORITY_KEYWORDS: { level: SeniorityLevel; pattern: RegExp }[] = [
  { level: 'director', pattern: /\bdirector\b|\bvice president\b|\bvp\b/i },
  { level: 'principal', pattern: /\bprincipal\b/i },
  { level: 'staff', pattern: /\bstaff\b/i },
  { level: 'manager', pattern: /\bmanager\b|\bhead of\b/i },
  { level: 'senior', pattern: /\bsenior\b|\bsr\.?\s|\blead\b/i },
  { level: 'entry', pattern: /\bjunior\b|\bjr\.?\s|\bentry.level\b|\bassociate\b|\bintern\b/i },
];

export function isManagementTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return /\bmanager\b|\bdirector\b|\bvp\b|\bvice president\b|\bhead of\b|\bchief\b/i.test(title);
}

// A bare title with no seniority keyword (e.g. plain "Backend Engineer") defaults to 'mid' at
// reduced confidence - a reasonable middle assumption, not "entry" (which would require an
// explicit junior/associate signal) and not "senior" (which requires its own explicit signal).
export function inferSeniority(title: string | null | undefined): { level: SeniorityLevel; confidence: number } {
  if (!title || !title.trim()) return { level: 'unknown', confidence: 0 };
  for (const { level, pattern } of SENIORITY_KEYWORDS) {
    if (pattern.test(title)) return { level, confidence: 0.7 };
  }
  return { level: 'mid', confidence: 0.4 };
}

export function computeDurationMonths(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  isCurrent: boolean,
  asOf: Date
): number | null {
  const start = parseResumeDate(startDate);
  if (!start) return null;
  let end: Date;
  if (isCurrent) {
    end = asOf;
  } else {
    const parsedEnd = parseResumeDate(endDate);
    if (!parsedEnd) return null; // a past role with no determinable end date - never guess "now"
    end = parsedEnd;
  }
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

// Resolves a free-text title to a Role Intelligence role and a "domain" bucket for stability
// analysis's concentration calculation. When no confident lexical match exists, falls back to a
// normalized version of the raw title itself, so domain-concentration analysis still has
// something to group by rather than silently excluding the role - kept honestly distinct from a
// real match (roleProfileId stays null in that case).
async function resolveJobRole(title: string | null | undefined): Promise<{ roleProfileId: number | null; domain: string | null }> {
  if (!title || !title.trim()) return { roleProfileId: null, domain: null };
  const role = await findLexicalRoleMatch(title);
  if (role) return { roleProfileId: role.id, domain: role.role_key };
  return { roleProfileId: null, domain: normalizeForLexicalMatch(title) || null };
}

export async function normalizeJobSequence(
  workHistory: WorkHistoryEntry[] | null | undefined,
  asOf: Date = new Date()
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];

  for (const entry of workHistory || []) {
    const { level, confidence: baseConfidence } = inferSeniority(entry.title);
    const durationMonths = computeDurationMonths(entry.start_date, entry.end_date, entry.is_current, asOf);

    // Cross-check against tenure ("never trust title alone", Decision 1): an elevated title held
    // for under 3 verified months is real, but weaker evidence of genuinely operating at that
    // level than the same title held for a year+.
    const isElevated = SENIORITY_ORDER.indexOf(level) > SENIORITY_ORDER.indexOf('mid');
    const confidence = isElevated && durationMonths !== null && durationMonths < 3
      ? Math.max(0.2, baseConfidence - 0.3)
      : baseConfidence;

    const { roleProfileId, domain } = await resolveJobRole(entry.title);

    jobs.push({
      roleProfileId,
      title: entry.title,
      company: entry.company,
      startDate: entry.start_date,
      endDate: entry.end_date,
      isCurrent: entry.is_current,
      durationMonths,
      inferredSeniority: level,
      inferredSeniorityConfidence: Number(confidence.toFixed(2)),
      domain,
    });
  }

  // work_history's array order isn't guaranteed chronological (the parser extracts per employment
  // block, but doesn't itself re-sort) - order by start_date; undated entries sort first since
  // there's no confident basis to place them anywhere else.
  const ordered = jobs.sort((a, b) => {
    const aDate = parseResumeDate(a.startDate);
    const bDate = parseResumeDate(b.startDate);
    if (!aDate && !bDate) return 0;
    if (!aDate) return -1;
    if (!bDate) return 1;
    return aDate.getTime() - bDate.getTime();
  });

  // Overlap warning only - never a hard rejection or a silent fix. Resumes are self-reported and
  // sometimes state genuinely overlapping roles (e.g. moonlighting, transition periods).
  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = ordered[i - 1].isCurrent ? asOf : parseResumeDate(ordered[i - 1].endDate);
    const nextStart = parseResumeDate(ordered[i].startDate);
    if (prevEnd && nextStart && nextStart < prevEnd) {
      logger.debug({ prev: ordered[i - 1].title, next: ordered[i].title }, 'Career Intelligence: overlapping work_history date ranges detected');
    }
  }

  return ordered;
}
