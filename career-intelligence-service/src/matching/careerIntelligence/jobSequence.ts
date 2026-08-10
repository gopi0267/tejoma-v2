// Ported from the monolith's src/matching/careerIntelligence/jobSequence.ts - byte-identical
// logic. Turns work_history into a normalized, ordered sequence with inferred seniority and a
// resolved domain per role.
//
// ROLE RESOLUTION - reuses this service's own dynamicWeighting.ts's findLexicalRoleMatch/
// normalizeForLexicalMatch (a port of the same primitives), which read this service's own
// dual-written role_profiles mirror rather than the monolith's table.

import { findLexicalRoleMatch, normalizeForLexicalMatch } from '../dynamicWeighting.js';
import { parseResumeDate } from '../skillRecency.js';
import { logger } from '../../utils/logger.js';
import type { NormalizedJob, SeniorityLevel, WorkHistoryEntry } from '../../types.js';

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
    if (!parsedEnd) return null;
    end = parsedEnd;
  }
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

export async function resolveJobRole(title: string | null | undefined): Promise<{ roleProfileId: number | null; domain: string | null }> {
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

  const ordered = jobs.sort((a, b) => {
    const aDate = parseResumeDate(a.startDate);
    const bDate = parseResumeDate(b.startDate);
    if (!aDate && !bDate) return 0;
    if (!aDate) return -1;
    if (!bDate) return 1;
    return aDate.getTime() - bDate.getTime();
  });

  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = ordered[i - 1].isCurrent ? asOf : parseResumeDate(ordered[i - 1].endDate);
    const nextStart = parseResumeDate(ordered[i].startDate);
    if (prevEnd && nextStart && nextStart < prevEnd) {
      logger.debug({ prev: ordered[i - 1].title, next: ordered[i].title }, 'Career Intelligence: overlapping work_history date ranges detected');
    }
  }

  return ordered;
}
