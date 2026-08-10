// Enterprise AI Matching Architecture, Phases 11B + 12 - Proficiency & Career Analytics.
//
// Real analytics over the shadow data Phases 11/12 are already collecting - a substitute for
// both phases' original A/B guardrail/alerting/rollback specs, which assumed live
// control-vs-variant traffic that does not exist (both were deliberately kept shadow-only;
// nothing in this codebase ever selects a scoring variant). This answers the real, honest
// version of the same underlying question each spec's own "Shadow Mode" phase asked: does this
// weighting signal look like it would matter, and in what direction, if it were ever turned on?
//
// Three real signals per weighting signal, each computed from proficiency_shadow_scores directly
// (no batching, no cron - this data is small enough per company that a live SQL aggregation is
// simpler and more honest than inventing an hourly job for it):
//   1. Acceptance rate by signal bucket/type - does the recruiter's real decision correlate with
//      the signal, using their own decision as the outcome?
//   2. Score movement - how much would scores actually move, on average?
//   3. Ranking impact - for jobs with multiple candidates, how often would the TOP-ranked
//      candidate actually change? (Both specs' own stated Shadow Mode analysis goal - "how often
//      does this change ranking?" - answered here with real data instead of a fabricated
//      guardrail dashboard.)
//
// Career's three functions (computeAcceptanceRateByProgressionType/
// computeCareerScoreMovementSummary/computeCareerRankingImpact) only consider rows where
// career_adjusted_score is populated (candidate had a computed career_trajectories row at
// decision time) - same "skip, don't fabricate" discipline the proficiency functions already
// apply to rows with no decision_action.

import { db } from '../db.js';
import type { ProficiencyShadowScore } from '../types.js';

export type MultiplierBucket = 'below' | 'neutral' | 'above';
const BELOW_THRESHOLD = 0.98;
const ABOVE_THRESHOLD = 1.02;

export function bucketForMultiplier(multiplier: number): MultiplierBucket {
  if (multiplier < BELOW_THRESHOLD) return 'below';
  if (multiplier > ABOVE_THRESHOLD) return 'above';
  return 'neutral';
}

export interface AcceptanceRateBucket {
  bucket: MultiplierBucket;
  sampleSize: number;
  acceptedCount: number;
  acceptanceRate: number | null;
}

// Pure - only rows with a real recorded decision are informative; a row with no decision_action
// (pre-Phase-11B data, or a future write path that never sets it) contributes no outcome signal
// and is skipped rather than treated as a rejection.
export function computeAcceptanceRateByBucket(rows: Array<{ overall_multiplier: number; decision_action: number | null }>): AcceptanceRateBucket[] {
  const buckets: Record<MultiplierBucket, { total: number; accepted: number }> = {
    below: { total: 0, accepted: 0 },
    neutral: { total: 0, accepted: 0 },
    above: { total: 0, accepted: 0 },
  };

  for (const row of rows) {
    if (row.decision_action === null) continue;
    const bucket = bucketForMultiplier(row.overall_multiplier);
    buckets[bucket].total++;
    if (row.decision_action === 1) buckets[bucket].accepted++;
  }

  return (['below', 'neutral', 'above'] as MultiplierBucket[]).map((bucket) => ({
    bucket,
    sampleSize: buckets[bucket].total,
    acceptedCount: buckets[bucket].accepted,
    acceptanceRate: buckets[bucket].total > 0 ? Number((buckets[bucket].accepted / buckets[bucket].total).toFixed(4)) : null,
  }));
}

export interface ScoreMovementSummary {
  sampleSize: number;
  meanDelta: number | null;
  medianDelta: number | null;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
}

// Pure. "Unchanged" allows a small (0.01) tolerance for floating-point rounding, not a real
// threshold judgment. Shared by both the proficiency and career score-movement functions below.
function summarizeDeltas(deltas: number[]): ScoreMovementSummary {
  if (deltas.length === 0) {
    return { sampleSize: 0, meanDelta: null, medianDelta: null, increasedCount: 0, decreasedCount: 0, unchangedCount: 0 };
  }

  const sorted = [...deltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const mean = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;

  return {
    sampleSize: deltas.length,
    meanDelta: Number(mean.toFixed(4)),
    medianDelta: Number(median.toFixed(4)),
    increasedCount: deltas.filter((d) => d > 0.01).length,
    decreasedCount: deltas.filter((d) => d < -0.01).length,
    unchangedCount: deltas.filter((d) => Math.abs(d) <= 0.01).length,
  };
}

export function computeScoreMovementSummary(rows: Array<{ base_match_score: number; proficiency_adjusted_score: number }>): ScoreMovementSummary {
  return summarizeDeltas(rows.map((r) => r.proficiency_adjusted_score - r.base_match_score));
}

// Career multiplier is chained on top of the proficiency-adjusted score (see shadowScoring.ts),
// so career's own movement is measured from THAT baseline, not the original base score - it
// isolates what career weighting alone would add.
export function computeCareerScoreMovementSummary(rows: Array<{ proficiency_adjusted_score: number; career_adjusted_score: number | null }>): ScoreMovementSummary {
  const deltas = rows.filter((r) => r.career_adjusted_score !== null).map((r) => r.career_adjusted_score! - r.proficiency_adjusted_score);
  return summarizeDeltas(deltas);
}

interface ShadowRow {
  job_id: number;
  candidate_id: number;
  base_match_score: number;
  proficiency_adjusted_score: number;
  computed_at: string;
}

// Pure - keeps only the most recent shadow row per (job, candidate) pair, so a candidate
// reconsidered multiple times for the same job doesn't get counted more than once in ranking
// comparisons. Assumes rows are already ordered most-recent-first (matches
// getAllProficiencyShadowScoresForCompany's ORDER BY computed_at DESC).
export function latestPerJobCandidate<T extends ShadowRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const key = `${row.job_id}:${row.candidate_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export interface RankingImpactSummary {
  jobsEvaluated: number;
  jobsWhereTopCandidateChanged: number;
  percentChanged: number | null;
}

// Pure - for every job with 2+ distinct candidates shadow-scored, compares who ranks #1 under
// the real base score vs. the shadow proficiency-adjusted score. This is the original spec's own
// stated Shadow Mode question ("how often would this change ranking?"), answered with real data.
export function computeRankingImpact(rows: ShadowRow[]): RankingImpactSummary {
  const byJob = new Map<number, ShadowRow[]>();
  for (const row of rows) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, []);
    byJob.get(row.job_id)!.push(row);
  }

  let jobsEvaluated = 0;
  let changed = 0;
  for (const jobRows of byJob.values()) {
    if (jobRows.length < 2) continue;
    jobsEvaluated++;
    const topByBase = jobRows.reduce((best, r) => (r.base_match_score > best.base_match_score ? r : best));
    const topByAdjusted = jobRows.reduce((best, r) => (r.proficiency_adjusted_score > best.proficiency_adjusted_score ? r : best));
    if (topByBase.candidate_id !== topByAdjusted.candidate_id) changed++;
  }

  return { jobsEvaluated, jobsWhereTopCandidateChanged: changed, percentChanged: jobsEvaluated > 0 ? Number(((changed / jobsEvaluated) * 100).toFixed(2)) : null };
}

export interface AcceptanceRateByProgressionType {
  progressionType: string;
  sampleSize: number;
  acceptedCount: number;
  acceptanceRate: number | null;
}

// Pure - skips rows with no recorded decision OR no career_progression_type (candidate had no
// computed career trajectory at decision time).
export function computeAcceptanceRateByProgressionType(rows: Array<{ career_progression_type: string | null; decision_action: number | null }>): AcceptanceRateByProgressionType[] {
  const buckets = new Map<string, { total: number; accepted: number }>();
  for (const row of rows) {
    if (row.decision_action === null || row.career_progression_type === null) continue;
    if (!buckets.has(row.career_progression_type)) buckets.set(row.career_progression_type, { total: 0, accepted: 0 });
    const bucket = buckets.get(row.career_progression_type)!;
    bucket.total++;
    if (row.decision_action === 1) bucket.accepted++;
  }
  return Array.from(buckets.entries()).map(([progressionType, bucket]) => ({
    progressionType,
    sampleSize: bucket.total,
    acceptedCount: bucket.accepted,
    acceptanceRate: bucket.total > 0 ? Number((bucket.accepted / bucket.total).toFixed(4)) : null,
  }));
}

// Pure - same structure as computeRankingImpact, but comparing the proficiency-adjusted score
// (career's own baseline) against the career-adjusted score, and only over rows where a career
// trajectory actually existed at decision time.
export function computeCareerRankingImpact(rows: Array<ShadowRow & { career_adjusted_score: number | null }>): RankingImpactSummary {
  const withCareer = rows.filter((r): r is ShadowRow & { career_adjusted_score: number } => r.career_adjusted_score !== null);
  const byJob = new Map<number, Array<ShadowRow & { career_adjusted_score: number }>>();
  for (const row of withCareer) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, []);
    byJob.get(row.job_id)!.push(row);
  }

  let jobsEvaluated = 0;
  let changed = 0;
  for (const jobRows of byJob.values()) {
    if (jobRows.length < 2) continue;
    jobsEvaluated++;
    const topByProficiency = jobRows.reduce((best, r) => (r.proficiency_adjusted_score > best.proficiency_adjusted_score ? r : best));
    const topByCareer = jobRows.reduce((best, r) => (r.career_adjusted_score > best.career_adjusted_score ? r : best));
    if (topByProficiency.candidate_id !== topByCareer.candidate_id) changed++;
  }

  return { jobsEvaluated, jobsWhereTopCandidateChanged: changed, percentChanged: jobsEvaluated > 0 ? Number(((changed / jobsEvaluated) * 100).toFixed(2)) : null };
}

export interface AcceptanceRateByRoleExpectation {
  roleExpectation: string;
  sampleSize: number;
  acceptedCount: number;
  acceptanceRate: number | null;
}

// Pure - skips rows with no recorded decision OR no recency_role_expectation snapshot.
export function computeAcceptanceRateByRoleExpectation(rows: Array<{ recency_role_expectation: string | null; decision_action: number | null }>): AcceptanceRateByRoleExpectation[] {
  const buckets = new Map<string, { total: number; accepted: number }>();
  for (const row of rows) {
    if (row.decision_action === null || row.recency_role_expectation === null) continue;
    if (!buckets.has(row.recency_role_expectation)) buckets.set(row.recency_role_expectation, { total: 0, accepted: 0 });
    const bucket = buckets.get(row.recency_role_expectation)!;
    bucket.total++;
    if (row.decision_action === 1) bucket.accepted++;
  }
  return Array.from(buckets.entries()).map(([roleExpectation, bucket]) => ({
    roleExpectation,
    sampleSize: bucket.total,
    acceptedCount: bucket.accepted,
    acceptanceRate: bucket.total > 0 ? Number((bucket.accepted / bucket.total).toFixed(4)) : null,
  }));
}

// Recency is chained on top of career_adjusted_score (falling back to proficiency_adjusted_score
// when no career trajectory existed - matches shadowScoring.ts's own chaining), so movement is
// measured from THAT baseline, isolating what recency alone would add.
export function computeRecencyScoreMovementSummary(rows: Array<{ career_adjusted_score: number | null; proficiency_adjusted_score: number; recency_adjusted_score: number | null }>): ScoreMovementSummary {
  const deltas = rows
    .filter((r) => r.recency_adjusted_score !== null)
    .map((r) => r.recency_adjusted_score! - (r.career_adjusted_score ?? r.proficiency_adjusted_score));
  return summarizeDeltas(deltas);
}

export function computeRecencyRankingImpact(rows: Array<ShadowRow & { career_adjusted_score: number | null; recency_adjusted_score: number | null }>): RankingImpactSummary {
  const withRecency = rows.filter((r): r is ShadowRow & { career_adjusted_score: number | null; recency_adjusted_score: number } => r.recency_adjusted_score !== null);
  const byJob = new Map<number, typeof withRecency>();
  for (const row of withRecency) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, []);
    byJob.get(row.job_id)!.push(row);
  }

  let jobsEvaluated = 0;
  let changed = 0;
  for (const jobRows of byJob.values()) {
    if (jobRows.length < 2) continue;
    jobsEvaluated++;
    const baseline = (r: (typeof jobRows)[number]) => r.career_adjusted_score ?? r.proficiency_adjusted_score;
    const topByBaseline = jobRows.reduce((best, r) => (baseline(r) > baseline(best) ? r : best));
    const topByRecency = jobRows.reduce((best, r) => (r.recency_adjusted_score > best.recency_adjusted_score ? r : best));
    if (topByBaseline.candidate_id !== topByRecency.candidate_id) changed++;
  }

  return { jobsEvaluated, jobsWhereTopCandidateChanged: changed, percentChanged: jobsEvaluated > 0 ? Number(((changed / jobsEvaluated) * 100).toFixed(2)) : null };
}

// Reasoning is chained on top of recency_adjusted_score (falling back through the same career ->
// proficiency chain when earlier signals had no data), so movement is measured from THAT
// baseline, isolating what reasoning alignment alone would add.
function reasoningBaseline(r: { career_adjusted_score: number | null; proficiency_adjusted_score: number; recency_adjusted_score: number | null }): number {
  return r.recency_adjusted_score ?? r.career_adjusted_score ?? r.proficiency_adjusted_score;
}

export function computeReasoningScoreMovementSummary(
  rows: Array<{ career_adjusted_score: number | null; proficiency_adjusted_score: number; recency_adjusted_score: number | null; reasoning_adjusted_score: number | null }>
): ScoreMovementSummary {
  const deltas = rows.filter((r) => r.reasoning_adjusted_score !== null).map((r) => r.reasoning_adjusted_score! - reasoningBaseline(r));
  return summarizeDeltas(deltas);
}

export function computeReasoningRankingImpact(
  rows: Array<ShadowRow & { career_adjusted_score: number | null; recency_adjusted_score: number | null; reasoning_adjusted_score: number | null }>
): RankingImpactSummary {
  const withReasoning = rows.filter((r): r is typeof r & { reasoning_adjusted_score: number } => r.reasoning_adjusted_score !== null);
  const byJob = new Map<number, typeof withReasoning>();
  for (const row of withReasoning) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, []);
    byJob.get(row.job_id)!.push(row);
  }

  let jobsEvaluated = 0;
  let changed = 0;
  for (const jobRows of byJob.values()) {
    if (jobRows.length < 2) continue;
    jobsEvaluated++;
    const topByBaseline = jobRows.reduce((best, r) => (reasoningBaseline(r) > reasoningBaseline(best) ? r : best));
    const topByReasoning = jobRows.reduce((best, r) => (r.reasoning_adjusted_score > best.reasoning_adjusted_score ? r : best));
    if (topByBaseline.candidate_id !== topByReasoning.candidate_id) changed++;
  }

  return { jobsEvaluated, jobsWhereTopCandidateChanged: changed, percentChanged: jobsEvaluated > 0 ? Number(((changed / jobsEvaluated) * 100).toFixed(2)) : null };
}

export interface ProficiencyAnalyticsSummary {
  totalShadowScores: number;
  acceptanceRateByBucket: AcceptanceRateBucket[];
  scoreMovement: ScoreMovementSummary;
  rankingImpact: RankingImpactSummary;
  career: {
    acceptanceRateByProgressionType: AcceptanceRateByProgressionType[];
    scoreMovement: ScoreMovementSummary;
    rankingImpact: RankingImpactSummary;
  };
  recency: {
    acceptanceRateByBucket: AcceptanceRateBucket[];
    acceptanceRateByRoleExpectation: AcceptanceRateByRoleExpectation[];
    scoreMovement: ScoreMovementSummary;
    rankingImpact: RankingImpactSummary;
  };
  reasoning: {
    acceptanceRateByBucket: AcceptanceRateBucket[];
    scoreMovement: ScoreMovementSummary;
    rankingImpact: RankingImpactSummary;
  };
  generatedAt: string;
}

// Orchestration - computed live on every request (see module doc for why: this data volume
// doesn't warrant a batch job, and correctness beats a premature caching layer).
export async function computeProficiencyAnalyticsSummary(companyId: number): Promise<ProficiencyAnalyticsSummary> {
  const rows: ProficiencyShadowScore[] = await db.getAllProficiencyShadowScoresForCompany(companyId);
  const latest = latestPerJobCandidate(rows);
  // Reuses the same bucket-by-multiplier logic already built for proficiency - "below/neutral/
  // above 1.0" is exactly as meaningful for the recency/reasoning multipliers as it is for
  // proficiency's.
  const recencyBucketRows = rows.filter((r): r is ProficiencyShadowScore & { recency_multiplier: number } => r.recency_multiplier !== null).map((r) => ({ overall_multiplier: r.recency_multiplier, decision_action: r.decision_action }));
  const reasoningBucketRows = rows.filter((r): r is ProficiencyShadowScore & { reasoning_multiplier: number } => r.reasoning_multiplier !== null).map((r) => ({ overall_multiplier: r.reasoning_multiplier, decision_action: r.decision_action }));

  return {
    totalShadowScores: rows.length,
    acceptanceRateByBucket: computeAcceptanceRateByBucket(rows),
    scoreMovement: computeScoreMovementSummary(rows),
    rankingImpact: computeRankingImpact(latest),
    career: {
      acceptanceRateByProgressionType: computeAcceptanceRateByProgressionType(rows),
      scoreMovement: computeCareerScoreMovementSummary(rows),
      rankingImpact: computeCareerRankingImpact(latest),
    },
    recency: {
      acceptanceRateByBucket: computeAcceptanceRateByBucket(recencyBucketRows),
      acceptanceRateByRoleExpectation: computeAcceptanceRateByRoleExpectation(rows),
      scoreMovement: computeRecencyScoreMovementSummary(rows),
      rankingImpact: computeRecencyRankingImpact(latest),
    },
    reasoning: {
      acceptanceRateByBucket: computeAcceptanceRateByBucket(reasoningBucketRows),
      scoreMovement: computeReasoningScoreMovementSummary(rows),
      rankingImpact: computeReasoningRankingImpact(latest),
    },
    generatedAt: new Date().toISOString(),
  };
}
