// Ported from the monolith's src/matching/careerIntelligence/progression.ts - byte-identical
// logic. Classifies each move between consecutive normalized jobs and derives whole-career
// signals (IC vs. management track, seniority trend).

import { SENIORITY_ORDER, isManagementTitle } from './jobSequence.js';
import type { CareerTransition, NormalizedJob, ProgressionType, SeniorityTrend, TransitionType } from '../../types.js';

function seniorityRank(level: string): number {
  return SENIORITY_ORDER.indexOf(level as any);
}

export function classifyTransition(from: NormalizedJob, to: NormalizedJob): CareerTransition {
  const confidence = Number(Math.min(from.inferredSeniorityConfidence, to.inferredSeniorityConfidence).toFixed(2));

  if (from.inferredSeniority === 'unknown' || to.inferredSeniority === 'unknown') {
    return {
      fromRole: from.title, toRole: to.title,
      fromSeniority: from.inferredSeniority, toSeniority: to.inferredSeniority,
      type: 'unknown', confidence,
      reasoning: 'Seniority could not be confidently inferred for one or both roles',
      timeInPreviousRoleMonths: from.durationMonths,
    };
  }

  const fromRank = seniorityRank(from.inferredSeniority);
  const toRank = seniorityRank(to.inferredSeniority);
  const domainChanged = from.domain !== null && to.domain !== null && from.domain !== to.domain;
  const fromIsBroad = /full.?stack|generalist/i.test(from.title || '');
  const toIsBroad = /full.?stack|generalist/i.test(to.title || '');

  let type: TransitionType;
  let reasoning: string;

  if (fromIsBroad && !toIsBroad && domainChanged) {
    type = 'specialization';
    reasoning = `Moved from a generalist/full-stack role to a focused ${to.domain ?? 'specific'} role`;
  } else if (!fromIsBroad && toIsBroad && domainChanged) {
    type = 'generalization';
    reasoning = `Moved from a focused ${from.domain ?? 'specific'} role to a broader full-stack/generalist role`;
  } else if (!domainChanged) {
    if (toRank > fromRank) {
      type = 'promotion';
      reasoning = `Same domain (${to.domain ?? 'unresolved'}), seniority increased from ${from.inferredSeniority} to ${to.inferredSeniority}`;
    } else {
      type = 'lateral_move';
      reasoning = `Same domain (${to.domain ?? 'unresolved'}), seniority ${toRank === fromRank ? 'unchanged' : 'decreased'} (${from.inferredSeniority} to ${to.inferredSeniority})`;
    }
  } else if (toRank > fromRank) {
    type = 'promotion';
    reasoning = `Domain changed (${from.domain ?? 'unresolved'} to ${to.domain ?? 'unresolved'}) alongside a seniority increase`;
  } else if (toRank < fromRank) {
    type = 'domain_pivot';
    reasoning = `Domain changed (${from.domain ?? 'unresolved'} to ${to.domain ?? 'unresolved'}) with a seniority decrease - consistent with restarting in a new domain`;
  } else {
    type = 'lateral_move';
    reasoning = `Same seniority level (${to.inferredSeniority}), different domain (${from.domain ?? 'unresolved'} to ${to.domain ?? 'unresolved'})`;
  }

  return {
    fromRole: from.title, toRole: to.title,
    fromSeniority: from.inferredSeniority, toSeniority: to.inferredSeniority,
    type, confidence, reasoning,
    timeInPreviousRoleMonths: from.durationMonths,
  };
}

export function determineProgressionType(jobs: NormalizedJob[]): ProgressionType {
  if (jobs.length === 0) return 'unclear';
  const managementCount = jobs.filter((j) => isManagementTitle(j.title)).length;
  if (managementCount === 0) return 'ic_track';
  if (managementCount === jobs.length) return 'management_track';
  return 'mixed';
}

export function determineSeniorityTrend(jobs: NormalizedJob[]): SeniorityTrend {
  const known = jobs.filter((j) => j.inferredSeniority !== 'unknown');
  if (known.length < 2) return 'unclear';

  const ranks = known.map((j) => seniorityRank(j.inferredSeniority));
  let nonDecreasing = true;
  let nonIncreasing = true;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] < ranks[i - 1]) nonDecreasing = false;
    if (ranks[i] > ranks[i - 1]) nonIncreasing = false;
  }

  const allEqual = ranks.every((r) => r === ranks[0]);
  if (allEqual) return 'stable';
  if (nonDecreasing && ranks[ranks.length - 1] > ranks[0]) return 'ascending';
  if (nonIncreasing && ranks[ranks.length - 1] < ranks[0]) return 'descending';
  return 'unclear';
}

export interface ProgressionAnalysis {
  progressionType: ProgressionType;
  seniorityLevel: NormalizedJob['inferredSeniority'];
  seniorityTrend: SeniorityTrend;
  transitions: CareerTransition[];
}

export function analyzeProgression(jobs: NormalizedJob[]): ProgressionAnalysis {
  const transitions: CareerTransition[] = [];
  for (let i = 1; i < jobs.length; i++) {
    transitions.push(classifyTransition(jobs[i - 1], jobs[i]));
  }
  const mostRecent = jobs[jobs.length - 1];
  return {
    progressionType: determineProgressionType(jobs),
    seniorityLevel: mostRecent?.inferredSeniority ?? 'unknown',
    seniorityTrend: determineSeniorityTrend(jobs),
    transitions,
  };
}
