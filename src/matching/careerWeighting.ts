// Enterprise AI Matching Architecture, Phase 12 - §2.4 Career Trajectory Weighting, SHADOW MODE
// ONLY.
//
// Same discipline and reasoning as Phase 11 (proficiencyWeighting.ts) - computes and shadow-logs
// what a career-trajectory-weighted score WOULD be, alongside every real decision. Never applied
// to a live match score. Per explicit user instruction, this phase reuses that exact pattern
// (shadow -> analytics -> decision, no A/B infrastructure).
//
// Corrections against real data, same class as Phase 11's:
//   1. The spec's Decision 3 ("Career Expectation") assumes role_profiles carries a per-role
//      expected progression_type/seniority_level/domain. It doesn't - role_profiles only ever
//      stored flat skill lists (Phase 1). The real, honest substitute used here: the JOB's own
//      title, run through the exact same inferSeniority()/isManagementTitle()/resolveJobRole()
//      functions §2.4 already uses to build a CANDIDATE's career trajectory - reusing the same
//      inference for the job side of the comparison, not inventing a second mechanism.
//   2. The spec's formula has an internal inconsistency: the IC-track rule is stated as a full
//      multiplier ("1.0 + diff*0.12") while the management-track-off-track rule is stated as a
//      flat multiplier ("0.85") - but its own worked example adds ONLY the delta portions
//      together as a "progression_signal" before applying `(1.0 + progression_signal)`. This
//      module normalizes every track case to a signal-relative-to-1.0 (mixed_track's flat 0.90
//      becomes signal -0.10; off-track's flat 0.85 becomes signal -0.15), consistent with the
//      worked example's own structure rather than either stated-but-conflicting formula.
//   3. The spec never states what happens when an IC-track candidate applies to a
//      management-track job (only the reverse case is given). Treated symmetrically here (same
//      off-track penalty) - a defensible, documented extension, not a silent guess.
//   4. The spec's confidence rule ("<0.70 interpolate toward 1.0") has the same
//      not-quite-linear worked-example issue Phase 11's did - resolved the same way: one
//      continuous linear blend toward neutral, confidence=0 -> exactly 1.0.
//   5. "career_trajectory_confidence" isn't a stored field - same proxy Phase 10's
//      explainability layer already uses: the most recent job_sequence entry's own
//      inferredSeniorityConfidence.

import { db } from '../db.js';
import { SENIORITY_ORDER, inferSeniority, isManagementTitle, resolveJobRole } from './careerIntelligence/jobSequence.js';
import type { Candidate, Job, ProgressionType, SeniorityLevel, SeniorityTrend, TenurePattern, EmploymentGap, CareerMultiplierResult } from '../types.js';

const IC_LEVEL_STEP = 0.12;
const MANAGEMENT_LEVEL_STEP = 0.1;
const MIXED_TRACK_SIGNAL = -0.1; // spec's flat 0.90, expressed relative to 1.0
const OFF_TRACK_SIGNAL = -0.15; // spec's flat 0.85, expressed relative to 1.0
const TRACK_SIGNAL_CAP = 0.25;

const TREND_SIGNAL: Record<SeniorityTrend, number> = { ascending: 0.08, stable: 0, descending: -0.15, unclear: 0 };

// Pure. progressionSignal is additive relative to 1.0 - see module doc correction #2.
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
  // 'unclear' or null progressionType: trackSignal stays 0 - no penalty, no guess.
  trackSignal = Math.max(-TRACK_SIGNAL_CAP, Math.min(TRACK_SIGNAL_CAP, trackSignal));

  const trendSignal = seniorityTrend ? TREND_SIGNAL[seniorityTrend] : 0;
  return Number((trackSignal + trendSignal).toFixed(4));
}

const TENURE_MULTIPLIER: Record<TenurePattern, number> = { stable: 1, variable: 0.9, short: 0.8, unclear: 1 };
// Spec gives two named points ("1-year gap" -> 0.95, "2+ year gap" -> 0.85) without a precise
// boundary; 24 months is the documented, defensible cutoff used here between them.
const LONG_GAP_MONTHS = 24;

// Pure - uses the LONGEST single gap, not total gap time, since one extended gap and several
// short ones are different signals the spec's two named points don't distinguish either way.
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

// Pure - domain match compares the candidate's #1 domain (already sorted by months in
// CareerTrajectory.domains - Phase 8) against the job's own resolved domain bucket. Neutral
// (1.0 match component) when either side can't be resolved - never penalizes for missing data.
export function computeDomainSignal(domainConcentration: number | null, candidatePrimaryDomain: string | null, jobDomain: string | null): number {
  const concentrationComponent = concentrationMultiplier(domainConcentration);
  const matchComponent = candidatePrimaryDomain && jobDomain ? (candidatePrimaryDomain.toLowerCase() === jobDomain.toLowerCase() ? 1.05 : 0.95) : 1;
  return Number((concentrationComponent * matchComponent).toFixed(4));
}

const MAX_MULTIPLIER = 1.35;
const MIN_MULTIPLIER = 0.6;

// Pure. Same confidence-blending unification as Phase 11's calculateProficiencyMultiplier (see
// module doc correction #4).
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

// Orchestration - null when the candidate has no computed career_trajectories row yet (never
// fabricates one; the background computation is already triggered elsewhere, at candidate
// creation/update - see computeCareerTrajectoryInBackground).
export async function computeCareerShadowResult(candidate: Candidate, job: Job, proficiencyAdjustedScore: number): Promise<CareerShadowResult | null> {
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
