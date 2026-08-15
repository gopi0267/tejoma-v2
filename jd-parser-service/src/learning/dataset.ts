/**
 * Phase 8 dataset assembly: tenant scoping, deduplication, replay protection, ordering.
 *
 * Pure functions over already-fetched rows. No database access, no training, no model. These are
 * the transformations that must happen between "rows in a table" and "a training set", and they are
 * written as testable functions precisely because the existing LTR performs none of them - it pushes
 * every swipe row into a group, so today's 33 duplicate rows would become 33 samples with
 * potentially contradictory grades.
 */

import { createHash } from 'node:crypto';
import {
  DATA_RULES, normaliseDecisionAction, DECISION_RELEVANCE, LABEL_POLICY_VERSION,
  type ConflictPolicy, type DecisionLabel, type TenantScopeDeclaration,
} from './contract.js';
import type { CorpusStats } from './sufficiency.js';

/** A raw decision event as read from `swipes`. Deliberately permissive - validation happens here. */
export interface RawDecisionEvent {
  event_id?: string | number | null;
  tenant_id?: string | number | null;
  job_id?: number | null;
  candidate_id?: number | null;
  action?: number | string | null;
  event_timestamp?: string | null;
}

export interface TrainingRow {
  tenant_id: string;
  job_id: number;
  candidate_id: number;
  event_id: string;
  event_timestamp: string;
  label: DecisionLabel;
  relevance: number;
  /** Events superseded by this row under the conflict policy, retained for audit. */
  superseded_event_ids: string[];
}

export interface AssemblyReport {
  rows: TrainingRow[];
  droppedMissingIdentity: number;
  droppedUnknownAction: number;
  droppedReplay: number;
  droppedAmbiguousOrder: number;
  droppedForeignTenant: number;
  supersededByConflictPolicy: number;
  conflictingPairs: number;
}

const key = (r: { tenant_id: string; job_id: number; candidate_id: number }) =>
  `${r.tenant_id}|${r.job_id}|${r.candidate_id}`;

/**
 * Turn raw events into a deduplicated, tenant-scoped training set.
 *
 * TENANT SCOPE IS A REQUIRED ARGUMENT, not an option. There is no code path that assembles a
 * dataset without stating whose data it is - a global set requires an explicit
 * GLOBAL_AUTHORIZED declaration carrying an authorisation reference, and even then every row keeps
 * its own tenant_id so the resulting model can record what it was trained on.
 */
export function assembleTrainingRows(
  events: RawDecisionEvent[],
  scope: TenantScopeDeclaration,
  conflictPolicy: ConflictPolicy = DATA_RULES.conflict_policy,
): AssemblyReport {
  if (scope.scope === 'SINGLE_TENANT' && !scope.tenant_id) {
    throw new Error('SINGLE_TENANT scope requires a tenant_id');
  }
  if (scope.scope === 'GLOBAL_AUTHORIZED' && !scope.authorization_reference) {
    throw new Error('GLOBAL_AUTHORIZED scope requires an authorization_reference');
  }

  const report: AssemblyReport = {
    rows: [], droppedMissingIdentity: 0, droppedUnknownAction: 0, droppedReplay: 0,
    droppedAmbiguousOrder: 0, droppedForeignTenant: 0, supersededByConflictPolicy: 0,
    conflictingPairs: 0,
  };

  const seenEventIds = new Set<string>();
  const normalised: TrainingRow[] = [];

  for (const e of events) {
    const tenant = e.tenant_id === null || e.tenant_id === undefined ? null : String(e.tenant_id);
    const eventId = e.event_id === null || e.event_id === undefined ? null : String(e.event_id);

    // Identity is mandatory and never defaulted; a synthesised tenant is how contamination starts.
    if (!tenant || !eventId || e.job_id == null || e.candidate_id == null || !e.event_timestamp) {
      report.droppedMissingIdentity++;
      continue;
    }
    // Tenant scoping. A foreign row is dropped, never relabelled.
    if (scope.scope === 'SINGLE_TENANT' && tenant !== scope.tenant_id) {
      report.droppedForeignTenant++;
      continue;
    }
    // Replay protection: a repeated event id is the same event delivered twice.
    if (seenEventIds.has(eventId)) { report.droppedReplay++; continue; }
    seenEventIds.add(eventId);

    const label = normaliseDecisionAction(e.action);
    if (!label) { report.droppedUnknownAction++; continue; }

    normalised.push({
      tenant_id: tenant, job_id: e.job_id, candidate_id: e.candidate_id,
      event_id: eventId, event_timestamp: e.event_timestamp,
      label, relevance: DECISION_RELEVANCE[label], superseded_event_ids: [],
    });
  }

  // ---- collapse to one row per (tenant, job, candidate)
  const byPair = new Map<string, TrainingRow[]>();
  for (const r of normalised) {
    const k = key(r);
    const list = byPair.get(k) ?? [];
    list.push(r);
    byPair.set(k, list);
  }

  for (const [, group] of byPair) {
    if (group.length === 1) { report.rows.push(group[0]); continue; }

    const distinctLabels = new Set(group.map((g) => g.label));
    if (distinctLabels.size > 1) report.conflictingPairs++;

    if (conflictPolicy === 'REJECT_ROW') {
      report.supersededByConflictPolicy += group.length;
      continue;
    }

    const sorted = [...group].sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp));
    const latest = sorted[sorted.length - 1];
    const runnerUp = sorted[sorted.length - 2];

    // Ties on timestamp cannot be ordered. Guessing here is exactly how a silent mislabel enters
    // the set, so the whole pair is dropped rather than resolved arbitrarily.
    if (runnerUp && runnerUp.event_timestamp === latest.event_timestamp
      && runnerUp.label !== latest.label) {
      report.droppedAmbiguousOrder += group.length;
      continue;
    }

    latest.superseded_event_ids = sorted.slice(0, -1).map((g) => g.event_id);
    report.supersededByConflictPolicy += group.length - 1;
    report.rows.push(latest);
  }

  report.rows.sort((a, b) => a.event_timestamp.localeCompare(b.event_timestamp)
    || a.event_id.localeCompare(b.event_id));
  return report;
}

/** Measure the assembled corpus. Feeds evaluateSufficiency; never estimates a missing value. */
export function computeCorpusStats(
  rows: TrainingRow[], minCandidatesPerGroup: number, assembly?: AssemblyReport,
): CorpusStats {
  const jobs = new Set<number>();
  const candidates = new Set<number>();
  const rowsPerTenant: Record<string, number> = {};
  const labelCounts: Record<DecisionLabel, number> = { REJECT: 0, SAVE: 0, ACCEPT: 0 };
  const byGroup = new Map<string, number>();

  let min = '', max = '';
  for (const r of rows) {
    jobs.add(r.job_id);
    candidates.add(r.candidate_id);
    rowsPerTenant[r.tenant_id] = (rowsPerTenant[r.tenant_id] ?? 0) + 1;
    labelCounts[r.label]++;
    const g = `${r.tenant_id}|${r.job_id}`;
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
    if (!min || r.event_timestamp < min) min = r.event_timestamp;
    if (!max || r.event_timestamp > max) max = r.event_timestamp;
  }

  const groupSizes = [...byGroup.values()].filter((n) => n >= minCandidatesPerGroup);
  const spanDays = min && max
    ? Math.max(0, Math.round((Date.parse(max) - Date.parse(min)) / 86_400_000)) : 0;

  return {
    totalPairs: rows.length,
    uniqueJobs: jobs.size,
    uniqueCandidates: candidates.size,
    rankingGroups: groupSizes.length,
    groupSizes,
    tenants: Object.keys(rowsPerTenant).length,
    rowsPerTenant,
    labelCounts,
    temporalSpanDays: spanDays,
    duplicatePairs: assembly?.supersededByConflictPolicy ?? 0,
    conflictingPairs: assembly?.conflictingPairs ?? 0,
    missingIdentityRows: assembly?.droppedMissingIdentity ?? 0,
  };
}

/**
 * Temporal, group-wise split. Groups are ordered by their EARLIEST event so that every group in the
 * test fold begins after every group in train - a random split would leak the same job across folds
 * and measure memorisation instead of generalisation.
 */
export function temporalGroupSplit(
  rows: TrainingRow[], trainRatio = 0.6, validationRatio = 0.2,
): { train: TrainingRow[]; validation: TrainingRow[]; test: TrainingRow[]; groups: number } {
  const byGroup = new Map<string, TrainingRow[]>();
  for (const r of rows) {
    const g = `${r.tenant_id}|${r.job_id}`;
    const list = byGroup.get(g) ?? [];
    list.push(r);
    byGroup.set(g, list);
  }
  const ordered = [...byGroup.entries()].sort((a, b) => {
    const ea = a[1].reduce((m, r) => (r.event_timestamp < m ? r.event_timestamp : m), a[1][0].event_timestamp);
    const eb = b[1].reduce((m, r) => (r.event_timestamp < m ? r.event_timestamp : m), b[1][0].event_timestamp);
    return ea.localeCompare(eb) || a[0].localeCompare(b[0]);
  });

  const n = ordered.length;
  const trainEnd = Math.floor(n * trainRatio);
  const valEnd = Math.floor(n * (trainRatio + validationRatio));
  const flat = (slice: [string, TrainingRow[]][]) => slice.flatMap(([, v]) => v);
  return {
    train: flat(ordered.slice(0, trainEnd)),
    validation: flat(ordered.slice(trainEnd, valEnd)),
    test: flat(ordered.slice(valEnd)),
    groups: n,
  };
}

/**
 * A content hash over the assembled set. This is the `dataset_version` a model version must record;
 * without it a training run cannot be reproduced or a metric attributed to the data that produced it.
 */
export function datasetVersion(rows: TrainingRow[], scope: TenantScopeDeclaration): string {
  const canonical = JSON.stringify({
    label_policy_version: LABEL_POLICY_VERSION,
    scope: scope.scope,
    tenant_id: scope.tenant_id,
    rows: rows.map((r) => [r.tenant_id, r.job_id, r.candidate_id, r.event_id, r.relevance]),
  });
  return 'dsv1:' + createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
