/**
 * Narrative Generation - Explainability Module, Module 1
 * Builds human-readable narrative objects from already-computed data.
 * Pure template functions, no DB calls or LLM.
 * Ported from monolith for computeExplanation orchestrator.
 */

import { SENIORITY_ORDER, inferSeniority, type SeniorityLevel } from '../careerIntelligence/jobSequence.js';
import type { SkillProficiency } from '../skillProficiency.js';

export interface SkillsNarrative {
  score: number | null;
  explanation: string;
  matched: string[];
  missing: string[];
  proficiency: Array<{ skill: string; tier: string; confidence: number }>;
}

export interface SeniorityNarrative {
  candidateLevel: SeniorityLevel | null;
  candidateLevelConfidence: number | null;
  jobLevel: SeniorityLevel | null;
  jobLevelConfidence: number | null;
  alignment: 'exact_match' | 'candidate_more_senior' | 'candidate_less_senior' | 'unknown';
  explanation: string;
}

export interface CareerProgressionNarrative {
  progressionType: string | null;
  seniorityTrend: string | null;
  explanation: string;
}

export interface TechnologyCoherenceNarrative {
  coherenceScore: number | null;
  explanation: string;
  reasoningConclusionId?: number;
}

export function buildSkillsNarrative(breakdown: any | null, proficiency: SkillProficiency[]): SkillsNarrative {
  if (!breakdown) {
    return {
      score: null,
      explanation: 'No scoring breakdown is available for this candidate/job pair yet.',
      matched: [],
      missing: [],
      proficiency: [],
    };
  }

  const { score, matched = [], missing = [] } = breakdown.skills ?? {};
  const proficiencyBySkill = new Map(proficiency.map((p) => [p.skillName.toLowerCase().trim(), p]));
  const matchedProficiency = matched
    .map((skill: string) => proficiencyBySkill.get(skill.toLowerCase().trim()))
    .filter((p): p is SkillProficiency => !!p && p.confidence > 0)
    .map((p) => ({ skill: p.skillName, tier: p.tier, confidence: p.confidence }));

  const total = matched.length + missing.length;
  const parts = [`${matched.length} of ${total} required skill${total === 1 ? '' : 's'} matched`];
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);

  return { score, explanation: parts.join('; ') + '.', matched, missing, proficiency: matchedProficiency };
}

function resolvedLevel(level: SeniorityLevel | null | undefined): SeniorityLevel | null {
  return level && level !== 'unknown' ? level : null;
}

export function buildSeniorityNarrative(
  candidateLevel: SeniorityLevel | null | undefined,
  candidateConfidence: number | null | undefined,
  jobTitle: string | null | undefined
): SeniorityNarrative {
  const jobInference = inferSeniority(jobTitle ?? null);
  const rCandidate = resolvedLevel(candidateLevel);
  const rJob = resolvedLevel(jobInference.level);
  const jobConfidence = rJob ? jobInference.confidence : null;

  if (!rCandidate || !rJob) {
    return {
      candidateLevel: rCandidate,
      candidateLevelConfidence: rCandidate ? candidateConfidence ?? null : null,
      jobLevel: rJob,
      jobLevelConfidence: jobConfidence,
      alignment: 'unknown',
      explanation: 'Seniority level could not be determined for the candidate and/or the job title.',
    };
  }

  const candidateRank = SENIORITY_ORDER.indexOf(rCandidate);
  const jobRank = SENIORITY_ORDER.indexOf(rJob);
  const alignment: SeniorityNarrative['alignment'] =
    candidateRank === jobRank ? 'exact_match' : candidateRank > jobRank ? 'candidate_more_senior' : 'candidate_less_senior';

  const explanation =
    alignment === 'exact_match'
      ? `Candidate's most recent role is at the ${rCandidate} level, matching this job's inferred ${rJob} level.`
      : alignment === 'candidate_more_senior'
        ? `Candidate's most recent role is at the ${rCandidate} level, above this job's inferred ${rJob} level.`
        : `Candidate's most recent role is at the ${rCandidate} level, below this job's inferred ${rJob} level.`;

  return { candidateLevel: rCandidate, candidateLevelConfidence: candidateConfidence ?? null, jobLevel: rJob, jobLevelConfidence: jobConfidence, alignment, explanation };
}

export function buildCareerProgressionNarrative(trajectory: any | null): CareerProgressionNarrative | null {
  if (!trajectory) return null;
  const parts: string[] = [];
  if (trajectory.progression_type) parts.push(`career progression type: ${trajectory.progression_type.replace(/_/g, ' ')}`);
  if (trajectory.seniority_trend && trajectory.seniority_trend !== 'unclear') parts.push(`seniority trend: ${trajectory.seniority_trend}`);

  return {
    progressionType: trajectory.progression_type,
    seniorityTrend: trajectory.seniority_trend,
    explanation: parts.length > 0 ? `Candidate's ${parts.join(', ')}.` : 'No clear career progression pattern detected from the candidate\'s work history.',
  };
}

export function buildTechnologyCoherenceNarrative(conclusion: any | null): TechnologyCoherenceNarrative | null {
  if (!conclusion) return null;
  return { coherenceScore: null, explanation: conclusion.conclusion_text, reasoningConclusionId: conclusion.id };
}

export function buildExecutiveSummary(
  candidateName: string | null | undefined,
  skills: SkillsNarrative,
  seniority: SeniorityNarrative,
  career: CareerProgressionNarrative | null
): string {
  const namePart = candidateName && candidateName.trim() ? candidateName.trim() : 'This candidate';
  const levelPart = seniority.candidateLevel ? `${seniority.candidateLevel}-level` : null;
  const trendPart = career?.seniorityTrend && career.seniorityTrend !== 'unclear' ? `, trending ${career.seniorityTrend}` : '';
  const total = skills.matched.length + skills.missing.length;
  const skillsPart = skills.score !== null ? `${skills.matched.length} of ${total} required skill${total === 1 ? '' : 's'} matched` : 'skill match data unavailable';

  return levelPart ? `${namePart} is a ${levelPart} candidate${trendPart}, with ${skillsPart}.` : `${namePart} has ${skillsPart}${trendPart}.`;
}
