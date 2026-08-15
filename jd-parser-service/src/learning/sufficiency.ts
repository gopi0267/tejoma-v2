/**
 * Phase 8 data-sufficiency gates.
 *
 * THE POINT OF THIS FILE
 * A ranking model can be fitted to almost any amount of data; it will produce a number, and the
 * number will look like progress. These gates exist so that the decision "is there enough data to
 * learn anything" is made once, in the open, against thresholds with stated reasons - not
 * implicitly by whoever runs the trainer first.
 *
 * When the gate is closed: no training, no promotion, no learned score, no production influence.
 * Phase 7's deterministic result remains authoritative. That is not a degraded mode; it is the
 * designed behaviour for every state except a proven-sufficient corpus.
 *
 * EVERY THRESHOLD BELOW CARRIES ITS REASONING. A threshold without a reason is a number someone
 * will later tune until the gate opens.
 */

import type { DecisionLabel } from './contract.js';

export interface SufficiencyThresholds {
  minTotalPairs: number;
  minUniqueJobs: number;
  minRankingGroups: number;
  minCandidatesPerGroup: number;
  minTenants: number;
  /** Minimum share of the corpus each observed decision label must hold, 0-1. */
  minLabelShare: number;
  minTemporalSpanDays: number;
  minValidationGroups: number;
  minTestGroups: number;
}

/**
 * Defaults, each anchored to a property of the ranking task rather than to taste.
 *
 * minRankingGroups = 50
 *   In a grouped ranking objective the GROUP is the unit of independent observation, not the row.
 *   A corpus with 6 groups has an effective sample size of 6 however many rows it holds. NDCG@10
 *   averaged over fewer than ~30 groups has a standard error wide enough that ordinary run-to-run
 *   noise exceeds any improvement worth shipping; 50 leaves headroom to split off validation and
 *   test groups and still measure the remainder.
 *
 * minValidationGroups / minTestGroups = 10
 *   Follows from the above: a 60/20/20 split of 50 groups yields 30/10/10. Fewer than 10 groups in
 *   a held-out fold makes the held-out metric an anecdote.
 *
 * minCandidatesPerGroup = 5
 *   NDCG@10 is degenerate on tiny groups - with 2 candidates almost any ordering scores near 1.0,
 *   so the metric stops discriminating exactly where it is most needed. The existing LTR trains at
 *   MIN_GROUP_SIZE = 2, which is why its reported figures cannot be taken as quality evidence.
 *
 * minTotalPairs = 500
 *   With 50 groups at the 5-candidate floor, 250 is the arithmetic minimum; 500 gives roughly 10
 *   candidates per group, which is the smallest corpus where a rank-order metric over 8 features
 *   is more signal than noise.
 *
 * minTenants = 3
 *   With one tenant there is no way to tell "learned what makes a good match" from "learned what
 *   this recruiter likes" - the two hypotheses fit the data equally well. Three is the minimum at
 *   which tenant-specific overfitting is detectable at all, and it is a floor, not a target.
 *
 * minLabelShare = 0.10
 *   A corpus that is 95% accept makes ranking trivial and the metric meaningless. Requiring every
 *   observed label to hold at least a tenth of the corpus keeps the ordering task real.
 *
 * minTemporalSpanDays = 90
 *   A temporal train/test split needs enough elapsed time that the test fold is genuinely "later"
 *   rather than the same week reshuffled, and hiring behaviour varies over a cycle longer than a
 *   month. 90 days spans more than one cycle while remaining achievable.
 */
export const DEFAULT_THRESHOLDS: SufficiencyThresholds = {
  minTotalPairs: 500,
  minUniqueJobs: 25,
  minRankingGroups: 50,
  minCandidatesPerGroup: 5,
  minTenants: 3,
  minLabelShare: 0.10,
  minTemporalSpanDays: 90,
  minValidationGroups: 10,
  minTestGroups: 10,
};

/** Measured shape of a candidate training corpus. Produced by the read-only audit, never assumed. */
export interface CorpusStats {
  totalPairs: number;
  uniqueJobs: number;
  uniqueCandidates: number;
  /** Groups meeting minCandidatesPerGroup. */
  rankingGroups: number;
  /** Every group's size, so the gate can report the distribution rather than a mean. */
  groupSizes: number[];
  tenants: number;
  /** Rows per tenant, to expose single-tenant dominance that a count alone hides. */
  rowsPerTenant: Record<string, number>;
  labelCounts: Record<DecisionLabel, number>;
  temporalSpanDays: number;
  duplicatePairs: number;
  conflictingPairs: number;
  missingIdentityRows: number;
}

export const SUFFICIENCY_VERDICTS = ['DATA_SUFFICIENT', 'DATA_INSUFFICIENT'] as const;
export type SufficiencyVerdict = (typeof SUFFICIENCY_VERDICTS)[number];

export interface GateResult {
  gate: string;
  passed: boolean;
  observed: number | string;
  required: number | string;
  reason: string;
}

export interface SufficiencyReport {
  verdict: SufficiencyVerdict;
  gates: GateResult[];
  failed: string[];
  /** True only when every gate passes. Training, promotion and learned scoring all key off this. */
  training_permitted: boolean;
  thresholds: SufficiencyThresholds;
  stats: CorpusStats;
}

/**
 * Evaluate every gate. Deliberately evaluates ALL of them rather than short-circuiting: a report
 * that stops at the first failure hides how far away sufficiency actually is, which is the number
 * anyone planning the work needs.
 */
export function evaluateSufficiency(
  stats: CorpusStats, thresholds: SufficiencyThresholds = DEFAULT_THRESHOLDS,
): SufficiencyReport {
  const gates: GateResult[] = [];
  const add = (gate: string, passed: boolean, observed: number | string,
    required: number | string, reason: string) =>
    gates.push({ gate, passed, observed, required, reason });

  add('total_labelled_pairs', stats.totalPairs >= thresholds.minTotalPairs,
    stats.totalPairs, thresholds.minTotalPairs,
    'below this a rank-order metric over the feature set is dominated by noise');

  add('unique_jobs', stats.uniqueJobs >= thresholds.minUniqueJobs,
    stats.uniqueJobs, thresholds.minUniqueJobs,
    'too few distinct jobs means the model memorises jobs rather than learning matching');

  add('ranking_groups', stats.rankingGroups >= thresholds.minRankingGroups,
    stats.rankingGroups, thresholds.minRankingGroups,
    'the group is the unit of independent observation in a grouped ranking objective');

  const smallest = stats.groupSizes.length ? Math.min(...stats.groupSizes) : 0;
  add('candidates_per_group', stats.groupSizes.length > 0
    && stats.groupSizes.every((n) => n >= thresholds.minCandidatesPerGroup),
    `min=${smallest}`, thresholds.minCandidatesPerGroup,
    'NDCG@10 is degenerate on tiny groups and stops discriminating between orderings');

  add('tenants', stats.tenants >= thresholds.minTenants,
    stats.tenants, thresholds.minTenants,
    'with one tenant, "good match" and "this recruiter\'s taste" are indistinguishable');

  // Dominance check: a tenant count can be met while one tenant still supplies nearly everything.
  const rows = Object.values(stats.rowsPerTenant);
  const dominance = rows.length && stats.totalPairs > 0 ? Math.max(...rows) / stats.totalPairs : 1;
  add('tenant_balance', dominance <= 0.80,
    `${(dominance * 100).toFixed(1)}% from the largest tenant`, '<= 80%',
    'a corpus dominated by one tenant trains that tenant\'s preferences and serves them to others');

  const totalLabels = Object.values(stats.labelCounts).reduce((a, b) => a + b, 0);
  const observedLabels = (Object.entries(stats.labelCounts) as [DecisionLabel, number][])
    .filter(([, n]) => n > 0);
  const minShare = totalLabels > 0 && observedLabels.length > 0
    ? Math.min(...observedLabels.map(([, n]) => n / totalLabels)) : 0;
  add('label_diversity', observedLabels.length >= 2 && minShare >= thresholds.minLabelShare,
    `${(minShare * 100).toFixed(1)}% smallest observed label`, `${thresholds.minLabelShare * 100}%`,
    'a near-degenerate label distribution makes the ordering task trivial');

  add('temporal_span_days', stats.temporalSpanDays >= thresholds.minTemporalSpanDays,
    stats.temporalSpanDays, thresholds.minTemporalSpanDays,
    'a temporal split needs the test fold to be genuinely later, across more than one hiring cycle');

  // Held-out folds are derived from the group count under the documented 60/20/20 temporal split.
  const validationGroups = Math.floor(stats.rankingGroups * 0.2);
  const testGroups = Math.floor(stats.rankingGroups * 0.2);
  add('validation_groups', validationGroups >= thresholds.minValidationGroups,
    validationGroups, thresholds.minValidationGroups,
    'a held-out fold below this size makes the held-out metric an anecdote');
  add('test_groups', testGroups >= thresholds.minTestGroups,
    testGroups, thresholds.minTestGroups,
    'the test fold must be large enough to detect a regression, not just report one');

  // Hygiene gates. These are not volume problems and cannot be fixed by waiting.
  add('no_unresolved_conflicts', stats.conflictingPairs === 0,
    stats.conflictingPairs, 0,
    'a pair with contradictory decisions must be resolved by the conflict policy before training');
  add('no_missing_identity', stats.missingIdentityRows === 0,
    stats.missingIdentityRows, 0,
    'a row missing tenant/job/candidate/event identity cannot be attributed and must be dropped');

  const failed = gates.filter((g) => !g.passed).map((g) => g.gate);
  const verdict: SufficiencyVerdict = failed.length === 0 ? 'DATA_SUFFICIENT' : 'DATA_INSUFFICIENT';
  return {
    verdict, gates, failed,
    training_permitted: verdict === 'DATA_SUFFICIENT',
    thresholds, stats,
  };
}

/**
 * The single guard every future training/promotion entry point must call first.
 * Returns the reasons rather than throwing, so a caller can log them and fall back cleanly.
 */
export function assertTrainingPermitted(report: SufficiencyReport):
{ permitted: boolean; reasons: string[] } {
  if (report.training_permitted) return { permitted: true, reasons: [] };
  return {
    permitted: false,
    reasons: report.gates.filter((g) => !g.passed)
      .map((g) => `${g.gate}: observed ${g.observed}, requires ${g.required} - ${g.reason}`),
  };
}
