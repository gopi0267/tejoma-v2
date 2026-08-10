/**
 * Concern Detection - Explainability Module, Module 2
 * Produces documented mismatches and gaps based on facts and evidence.
 * Pure functions, no DB calls or LLM.
 * Ported from monolith for computeExplanation orchestrator.
 */

import { SENIORITY_ORDER, type SeniorityLevel } from '../careerIntelligence/jobSequence.js';
import type { SeniorityNarrative } from './narrativeGeneration.js';

export interface ConcernNarrative {
  concernType: 'skill_gap' | 'career_gap' | 'seniority_mismatch';
  description: string;
  evidence: string;
  impact: string;
}

export interface EmploymentGap {
  startDate: string;
  endDate: string;
  durationMonths: number;
}

export function detectSkillGapConcern(missing: string[]): ConcernNarrative | null {
  if (missing.length === 0) return null;
  return {
    concernType: 'skill_gap',
    description: `This job requires ${missing.length} skill${missing.length === 1 ? '' : 's'} not found on the candidate's profile: ${missing.join(', ')}.`,
    evidence: `Job required_skills includes ${missing.join(', ')}; none appear in the candidate's matched skill list.`,
    impact: `${missing.length} of the job's required skills are unaccounted for.`,
  };
}

export function detectCareerGapConcerns(gaps: EmploymentGap[] | null): ConcernNarrative[] {
  if (!gaps || gaps.length === 0) return [];
  return gaps.map((gap) => ({
    concernType: 'career_gap' as const,
    description: `Employment gap of ${gap.durationMonths} month${gap.durationMonths === 1 ? '' : 's'} between ${gap.startDate} and ${gap.endDate}.`,
    evidence: `Derived from the candidate's work history: no role recorded between these two dates.`,
    impact: `A ${gap.durationMonths}-month gap in the documented work history.`,
  }));
}

export function detectSeniorityMismatchConcern(seniority: SeniorityNarrative): ConcernNarrative | null {
  if (seniority.alignment === 'exact_match' || seniority.alignment === 'unknown') return null;
  if (!seniority.candidateLevel || !seniority.jobLevel) return null;

  const levels = SENIORITY_ORDER.indexOf(seniority.candidateLevel) - SENIORITY_ORDER.indexOf(seniority.jobLevel);
  const distance = Math.abs(levels);
  const direction = seniority.alignment === 'candidate_more_senior' ? 'above' : 'below';

  return {
    concernType: 'seniority_mismatch',
    description: `Candidate's level (${seniority.candidateLevel}) is ${distance} level${distance === 1 ? '' : 's'} ${direction} this job's inferred level (${seniority.jobLevel}).`,
    evidence: seniority.explanation,
    impact: `A ${distance}-level seniority gap between candidate and job.`,
  };
}

export function detectConcerns(missing: string[], gaps: EmploymentGap[] | null, seniority: SeniorityNarrative): ConcernNarrative[] {
  const concerns: ConcernNarrative[] = [];
  const skillGap = detectSkillGapConcern(missing);
  if (skillGap) concerns.push(skillGap);
  concerns.push(...detectCareerGapConcerns(gaps));
  const seniorityMismatch = detectSeniorityMismatchConcern(seniority);
  if (seniorityMismatch) concerns.push(seniorityMismatch);
  return concerns;
}
