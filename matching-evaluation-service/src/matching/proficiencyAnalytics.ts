/**
 * Ported from the monolith's src/matching/proficiencyAnalytics.ts - byte-identical, only the db
 * import path changed (this service's own db.ts, reading its own dual-written mirror of
 * proficiency_shadow_scores - Batch 25 - instead of the monolith's copy). Every pure computation
 * function is unchanged.
 *
 * Real analytics over the shadow data the monolith's shadowScoring.ts is already collecting (see
 * that file - it stays on the monolith, unchanged). Three real signals per weighting signal, each
 * computed from proficiency_shadow_scores directly: acceptance rate by signal bucket/type, score
 * movement, and ranking impact (how often would the top-ranked candidate actually change).
 */
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

export async function computeProficiencyAnalyticsSummary(companyId: number): Promise<ProficiencyAnalyticsSummary> {
  const rows: ProficiencyShadowScore[] = await db.getAllProficiencyShadowScoresForCompany(companyId);
  const latest = latestPerJobCandidate(rows);
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
