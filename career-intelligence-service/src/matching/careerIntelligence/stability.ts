// Ported from the monolith's src/matching/careerIntelligence/stability.ts - byte-identical logic.
//
// FAIRNESS-CRITICAL MODULE, PER THE ARCHITECTURE DOC ITSELF: reports FACTS ONLY - a gap's start
// date, end date, and duration in months, never a cause; a tenure pattern label (stable/short/
// variable), never an interpretation or a score. NOT wired into any live scoring or screening path.

import { parseResumeDate } from '../skillRecency.js';
import type { DomainBreakdown, EmploymentGap, NormalizedJob, TenurePattern } from '../../types.js';

const MIN_GAP_MONTHS = 2;

export function computeTenureStats(jobs: NormalizedJob[]): { avgTenureMonths: number | null; medianTenureMonths: number | null; tenurePattern: TenurePattern } {
  const durations = jobs.map((j) => j.durationMonths).filter((d): d is number => d !== null);

  if (durations.length === 0) {
    return { avgTenureMonths: null, medianTenureMonths: null, tenurePattern: 'unclear' };
  }

  const avgTenureMonths = Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1));

  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianTenureMonths = Number((sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));

  let tenurePattern: TenurePattern;
  const allShort = durations.every((d) => d < 12);
  const allStable = durations.every((d) => d >= 24);
  if (durations.length === 1) {
    tenurePattern = durations[0] >= 24 ? 'stable' : durations[0] < 12 ? 'short' : 'variable';
  } else if (allShort) {
    tenurePattern = 'short';
  } else if (allStable) {
    tenurePattern = 'stable';
  } else {
    tenurePattern = 'variable';
  }

  return { avgTenureMonths, medianTenureMonths, tenurePattern };
}

export function findEmploymentGaps(jobs: NormalizedJob[], asOf: Date): EmploymentGap[] {
  const gaps: EmploymentGap[] = [];
  for (let i = 1; i < jobs.length; i++) {
    const prev = jobs[i - 1];
    const next = jobs[i];
    const prevEnd = prev.isCurrent ? asOf : parseResumeDate(prev.endDate);
    const nextStart = parseResumeDate(next.startDate);
    if (!prevEnd || !nextStart) continue;

    const gapMonths = (nextStart.getUTCFullYear() - prevEnd.getUTCFullYear()) * 12 + (nextStart.getUTCMonth() - prevEnd.getUTCMonth());
    if (gapMonths >= MIN_GAP_MONTHS && prev.endDate) {
      gaps.push({ startDate: prev.endDate, endDate: next.startDate!, durationMonths: gapMonths });
    }
  }
  return gaps;
}

export function analyzeDomainBreakdown(jobs: NormalizedJob[]): { domainConcentration: number | null; domains: DomainBreakdown[] } {
  const byDomain = new Map<string, { months: number; roleCount: number }>();
  let totalMonths = 0;

  for (const job of jobs) {
    if (!job.domain || job.durationMonths === null) continue;
    const entry = byDomain.get(job.domain) ?? { months: 0, roleCount: 0 };
    entry.months += job.durationMonths;
    entry.roleCount += 1;
    byDomain.set(job.domain, entry);
    totalMonths += job.durationMonths;
  }

  const domains: DomainBreakdown[] = Array.from(byDomain.entries())
    .map(([domain, { months, roleCount }]) => ({
      domain, roleCount, totalMonths: months,
      percentage: totalMonths > 0 ? Number((months / totalMonths).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.totalMonths - a.totalMonths);

  return { domainConcentration: domains.length > 0 ? domains[0].percentage : null, domains };
}

export interface StabilityAnalysis {
  avgTenureMonths: number | null;
  medianTenureMonths: number | null;
  tenurePattern: TenurePattern;
  gaps: EmploymentGap[];
  domainConcentration: number | null;
  domains: DomainBreakdown[];
}

export function analyzeStability(jobs: NormalizedJob[], asOf: Date = new Date()): StabilityAnalysis {
  const tenureStats = computeTenureStats(jobs);
  const gaps = findEmploymentGaps(jobs, asOf);
  const { domainConcentration, domains } = analyzeDomainBreakdown(jobs);
  return { ...tenureStats, gaps, domainConcentration, domains };
}
