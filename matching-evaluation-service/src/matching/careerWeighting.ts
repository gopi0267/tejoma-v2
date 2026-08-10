// Ported from the monolith's src/matching/careerWeighting.ts - byte-identical logic. SHADOW MODE
// ONLY - see the monolith's own module doc for the full correction rationale (unchanged here).
// Reads this service's own dual-written career_trajectories mirror (Batch 31, this table's first
// passive mirror anywhere in this migration - see db.ts's header comment) via db.getCareerTrajectory,
// not the monolith's table directly.

import { db } from '../db.js';
import { SENIORITY_ORDER, inferSeniority, isManagementTitle, resolveJobRole } from './seniorityInference.js';
import type { ShadowCandidate, ShadowJob, ProgressionType, SeniorityLevel, SeniorityTrend, TenurePattern, EmploymentGap, CareerMultiplierResult } from '../types.js';

const IC_LEVEL_STEP = 0.12;
const MANAGEMENT_LEVEL_STEP = 0.1;
const MIXED_TRACK_SIGNAL = -0.1;
const OFF_TRACK_SIGNAL = -0.15;
const TRACK_SIGNAL_CAP = 0.25;

const TREND_SIGNAL: Record<SeniorityTrend, number> = { ascending: 0.08, stable: 0, descending: -0.15, unclear: 0 };

export function computeProgressionSignal(
  progressionType: ProgressionType | null,
  candidateLevel: SeniorityLevel | null,
  jobLevel: SeniorityLevel | null,
  seniorityTrend: SeniorityTrend | null,
  jobIsManagementTrack: boolean
): number {
  const candidateRank = candidateLevel && candidateLevel !== 'unknown' ? SENIORITY_ORDER.indexOf(candidateLevel) : -1;
  const jobRank = jobLevel && jobLevel !== 'unknown' ? SENIORITY_ORDER.indexOf(jobLevel) : -1;
  const hasRanks = candidateRank >= 0 && jobRank >= 0;

  let trackSignal = 0;
  if (progressionType === 'ic_track') {
    trackSignal = jobIsManagementTrack ? OFF_TRACK_SIGNAL : hasRanks ? (candidateRank - jobRank) * IC_LEVEL_STEP : 0;
  } else if (progressionType === 'management_track') {
    trackSignal = jobIsManagementTrack ? (hasRanks ? (candidateRank - jobRank) * MANAGEMENT_LEVEL_STEP : 0) : OFF_TRACK_SIGNAL;
  } else if (progressionType === 'mixed') {
    trackSignal = MIXED_TRACK_SIGNAL;
  }
  trackSignal = Math.max(-TRACK_SIGNAL_CAP, Math.min(TRACK_SIGNAL_CAP, trackSignal));

  const trendSignal = seniorityTrend ? TREND_SIGNAL[seniorityTrend] : 0;
  return Number((trackSignal + trendSignal).toFixed(4));
}

const TENURE_MULTIPLIER: Record<TenurePattern, number> = { stable: 1, variable: 0.9, short: 0.8, unclear: 1 };
const LONG_GAP_MONTHS = 24;

export function computeStabilitySignal(tenurePattern: TenurePattern | null, gaps: EmploymentGap[] | null): number {
  const tenureComponent = tenurePattern ? TENURE_MULTIPLIER[tenurePattern] : 1;
  let gapComponent = 1;
  if (gaps && gaps.length > 0) {
    const maxGapMonths = Math.max(...gaps.map((g) => g.durationMonths));
    gapComponent = maxGapMonths >= LONG_GAP_MONTHS ? 0.85 : 0.95;
  }
  return Number((tenureComponent * gapComponent).toFixed(4));
}

const CONCENTRATION_BANDS: Array<{ min: number; multiplier: number }> = [
  { min: 0.8, multiplier: 1.1 },
  { min: 0.6, multiplier: 1.0 },
  { min: 0.4, multiplier: 0.95 },
  { min: 0, multiplier: 0.85 },
];

function concentrationMultiplier(domainConcentration: number | null): number {
  if (domainConcentration === null) return 1;
  for (const band of CONCENTRATION_BANDS) {
    if (domainConcentration >= band.min) return band.multiplier;
  }
  return 1;
}

export function computeDomainSignal(domainConcentration: number | null, candidatePrimaryDomain: string | null, jobDomain: string | null): number {
  const concentrationComponent = concentrationMultiplier(domainConcentration);
  const matchComponent = candidatePrimaryDomain && jobDomain ? (candidatePrimaryDomain.toLowerCase() === jobDomain.toLowerCase() ? 1.05 : 0.95) : 1;
  return Number((concentrationComponent * matchComponent).toFixed(4));
}

const MAX_MULTIPLIER = 1.35;
const MIN_MULTIPLIER = 0.6;

export function combineCareerSignals(progressionSignal: number, stabilitySignal: number, domainSignal: number, confidence: number): number {
  const raw = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, (1 + progressionSignal) * stabilitySignal * domainSignal));
  const c = Math.min(1, Math.max(0, confidence));
  return Number((1 + (raw - 1) * c).toFixed(4));
}

export interface CareerShadowResult {
  careerAdjustedScore: number;
  careerMultiplier: CareerMultiplierResult;
  progressionType: ProgressionType | null;
}

export async function computeCareerShadowResult(candidate: ShadowCandidate, job: ShadowJob, proficiencyAdjustedScore: number): Promise<CareerShadowResult | null> {
  const trajectory = await db.getCareerTrajectory(candidate.id, candidate.company_id);
  if (!trajectory) return null;

  const jobSeniority = inferSeniority(job.title);
  const jobLevel = jobSeniority.level === 'unknown' ? null : jobSeniority.level;
  const jobIsManagementTrack = isManagementTitle(job.title);
  const confidence = trajectory.job_sequence.length > 0 ? trajectory.job_sequence[trajectory.job_sequence.length - 1].inferredSeniorityConfidence : 0;

  const progressionSignal = computeProgressionSignal(trajectory.progression_type, trajectory.seniority_level, jobLevel, trajectory.seniority_trend, jobIsManagementTrack);
  const stabilitySignal = computeStabilitySignal(trajectory.tenure_pattern, trajectory.gaps);

  const jobRole = await resolveJobRole(job.title);
  const candidatePrimaryDomain = trajectory.domains && trajectory.domains.length > 0 ? trajectory.domains[0].domain : null;
  const domainSignal = computeDomainSignal(trajectory.domain_concentration, candidatePrimaryDomain, jobRole.domain);

  const multiplier = combineCareerSignals(progressionSignal, stabilitySignal, domainSignal, confidence);

  const reasoning = `${trajectory.progression_type ?? 'unclear'} progression (trend: ${trajectory.seniority_trend ?? 'unclear'}), ${trajectory.tenure_pattern ?? 'unclear'} tenure, ${candidatePrimaryDomain ?? 'unknown'} domain focus vs. job domain ${jobRole.domain ?? 'unresolved'} - confidence ${confidence.toFixed(2)}.`;

  const careerAdjustedScore = Number(Math.min(100, Math.max(0, proficiencyAdjustedScore * multiplier)).toFixed(2));

  return {
    careerAdjustedScore,
    careerMultiplier: { multiplier, progressionSignal, stabilitySignal, domainSignal, confidence, reasoning },
    progressionType: trajectory.progression_type,
  };
}
