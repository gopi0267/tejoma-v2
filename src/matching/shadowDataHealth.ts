// Enterprise AI Matching Architecture, Phase 12D - Shadow Data Health Check.
//
// On-demand replacement for the original spec's daily-cron-plus-email-alert monitoring system.
// That system assumed infrastructure that doesn't exist here (no mailer/ops-alerting channel, no
// `is_test`/`is_qa_account` flags, no persisted job-queue-with-status table - proficiency/career
// shadow computation is a plain fire-and-forget async call, not a tracked queue - see
// shadowScoring.ts). It also assumed something no agent can do inside one session: watching
// production accumulate real decisions over real days/weeks. What's real and buildable is this:
// one endpoint that tells the truth about current volume, data quality, and segment spread
// whenever someone (now or in a future session) checks in - see GET /api/shadow-data-health.
//
// "Real" rows aren't distinguished by an is_test flag - this project's own discipline has been to
// create test data and delete it again after every phase's live verification (see every prior
// phase's cleanup step), so anything actually sitting in proficiency_shadow_scores at query time
// already reflects genuine usage, not leftover fixtures.

import { db } from '../db.js';
import { inferSeniority } from './careerIntelligence/jobSequence.js';
import type { ProficiencyShadowScore } from '../types.js';

// Same threshold the original spec's own data-quality guardrail defines as the minimum before a
// signal comparison is trustworthy (see the Phase 12C recommendation's appendix).
export const DECIDED_MATCH_THRESHOLD = 200;

export interface VolumeSummary {
  totalRows: number;
  rowsWithDecision: number;
  pctWithDecision: number | null;
  rowsWithProficiency: number;
  pctNullProficiency: number | null;
  rowsWithCareer: number;
  pctNullCareer: number | null;
  distinctCandidates: number;
  distinctJobs: number;
  earliestRow: string | null;
  latestRow: string | null;
  daysSinceFirstRow: number | null;
  decidedMatchThreshold: number;
  thresholdReached: boolean;
}

function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : null;
}

// Pure - takes rows already fetched, so it's testable without the DB.
export function computeVolumeSummary(rows: ProficiencyShadowScore[]): VolumeSummary {
  const total = rows.length;
  const withDecision = rows.filter((r) => r.decision_action !== null).length;
  const withProficiency = rows.filter((r) => r.overall_multiplier !== null && r.overall_multiplier !== undefined).length;
  const withCareer = rows.filter((r) => r.career_multiplier !== null).length;

  const timestamps = rows.map((r) => new Date(r.computed_at).getTime()).filter((t) => !Number.isNaN(t));
  const earliest = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
  const latest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
  const daysSinceFirstRow = earliest ? Math.floor((Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24)) : null;

  return {
    totalRows: total,
    rowsWithDecision: withDecision,
    pctWithDecision: pct(withDecision, total),
    rowsWithProficiency: withProficiency,
    pctNullProficiency: pct(total - withProficiency, total),
    rowsWithCareer: withCareer,
    pctNullCareer: pct(total - withCareer, total),
    distinctCandidates: new Set(rows.map((r) => r.candidate_id)).size,
    distinctJobs: new Set(rows.map((r) => r.job_id)).size,
    earliestRow: earliest ? earliest.toISOString() : null,
    latestRow: latest ? latest.toISOString() : null,
    daysSinceFirstRow,
    decidedMatchThreshold: DECIDED_MATCH_THRESHOLD,
    thresholdReached: withDecision >= DECIDED_MATCH_THRESHOLD,
  };
}

export interface SegmentCount {
  segment: string;
  count: number;
}

// Pure - jobSeniorityByJobId is resolved by the caller (one inferSeniority() call per DISTINCT
// job, not per row) so this stays a cheap, testable aggregation with no DB/inference dependency
// of its own. Only counts rows with a real decision - matches the same "decided matches" the
// 200-threshold counts, not raw shadow-computation volume.
export function computeSenioritySpread(rows: ProficiencyShadowScore[], jobSeniorityByJobId: Map<number, string>): SegmentCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.decision_action === null) continue;
    const level = jobSeniorityByJobId.get(row.job_id) ?? 'unknown';
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count);
}

// Pure - career_progression_type is already stored per-row (a decision-time snapshot, see
// migration-phase12-career-shadow.sql), so no resolution step is needed here.
export function computeCareerTrackSpread(rows: ProficiencyShadowScore[]): SegmentCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.decision_action === null || row.career_progression_type === null) continue;
    counts.set(row.career_progression_type, (counts.get(row.career_progression_type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count);
}

// Pure - recency_role_expectation is already stored per-row (a decision-time snapshot, see
// migration-phase13-recency-shadow.sql).
export function computeRecencyRoleExpectationSpread(rows: ProficiencyShadowScore[]): SegmentCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.decision_action === null || row.recency_role_expectation === null) continue;
    counts.set(row.recency_role_expectation, (counts.get(row.recency_role_expectation) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count);
}

// Pure - buckets by how much of the job's domain requirements the candidate's reasoning
// conclusions covered (reasoning_coverage_signal, a decision-time snapshot - see
// migration-phase15-reasoning-shadow.sql). "none" also covers rows with no coverage signal at
// all (candidate/job had no hierarchical conclusions yet).
export function computeReasoningCoverageSpread(rows: ProficiencyShadowScore[]): SegmentCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.decision_action === null) continue;
    const signal = row.reasoning_coverage_signal;
    const bucket = signal === null || signal === 0 ? 'none' : signal < 1 ? 'partial' : 'full';
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ShadowDataHealthSummary {
  volume: VolumeSummary;
  segmentSpread: {
    bySeniority: SegmentCount[];
    byCareerTrack: SegmentCount[];
    byRecencyRoleExpectation: SegmentCount[];
    byReasoningCoverage: SegmentCount[];
  };
  generatedAt: string;
}

// Orchestration - resolves each DISTINCT job's seniority once (via the existing, real
// inferSeniority() on job.title - no stored job.seniority_level column exists) rather than once
// per row.
export async function computeShadowDataHealth(companyId: number): Promise<ShadowDataHealthSummary> {
  const rows = await db.getAllProficiencyShadowScoresForCompany(companyId);

  const distinctJobIds = Array.from(new Set(rows.map((r) => r.job_id)));
  const jobs = await Promise.all(distinctJobIds.map((id) => db.getJobById(id, companyId)));
  const jobSeniorityByJobId = new Map<number, string>();
  for (const job of jobs) {
    if (job) jobSeniorityByJobId.set(job.id, inferSeniority(job.title).level);
  }

  return {
    volume: computeVolumeSummary(rows),
    segmentSpread: {
      bySeniority: computeSenioritySpread(rows, jobSeniorityByJobId),
      byCareerTrack: computeCareerTrackSpread(rows),
      byRecencyRoleExpectation: computeRecencyRoleExpectationSpread(rows),
      byReasoningCoverage: computeReasoningCoverageSpread(rows),
    },
    generatedAt: new Date().toISOString(),
  };
}
