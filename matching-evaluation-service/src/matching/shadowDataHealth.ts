/**
 * Ported from the monolith's src/matching/shadowDataHealth.ts - Enterprise AI Matching
 * Architecture, Phase 12D Shadow Data Health Check. Every pure computation function is
 * byte-identical to the monolith's original; the only changes are where data comes from:
 * db.getAllProficiencyShadowScoresForCompany (a local read against this database's own,
 * dual-written mirror of proficiency_shadow_scores - Batch 25) is unchanged, but
 * db.getJobById(id, companyId) (a local monolith DB read) became
 * jobServiceClient.getJobTitles(companyId, jobIds) - a batched, company-scoped call to
 * job-service, which owns the jobs table (this previously proxied to the monolith on the
 * now-obsolete premise that jobs remained monolith-owned), and `inferSeniority` came from this service's own
 * matching/seniorityInference.ts instead of the monolith's careerIntelligence/jobSequence.ts (see
 * that file's header comment for why a small, separate copy - not a shared import - is correct
 * here).
 *
 * One endpoint that tells the truth about current volume, data quality, and segment spread
 * whenever someone checks in - see GET /api/shadow-data-health.
 */
import { db } from '../db.js';
import { getJobTitles } from '../services/jobServiceClient.js';
import { inferSeniority } from './seniorityInference.js';
import type { ProficiencyShadowScore } from '../types.js';

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

export async function computeShadowDataHealth(companyId: number): Promise<ShadowDataHealthSummary> {
  const rows = await db.getAllProficiencyShadowScoresForCompany(companyId);

  const distinctJobIds = Array.from(new Set(rows.map((r) => r.job_id)));
  const { jobs } = await getJobTitles(companyId, distinctJobIds);
  const jobSeniorityByJobId = new Map<number, string>();
  for (const job of jobs) {
    jobSeniorityByJobId.set(job.id, inferSeniority(job.title).level);
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
