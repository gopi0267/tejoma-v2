/**
 * Phase 8 learning-foundation regression suite.
 *
 * Tests the FOUNDATION only: data contract, assembly, tenant isolation, sufficiency gates,
 * evaluation-record attribution and drift definitions. There is no model here, so there is no model
 * quality to test - and inventing one would be exactly the fake-ML-quality failure this phase is
 * meant to prevent.
 *
 * The most important assertions in this file are the ones that must FAIL CLOSED: cross-tenant
 * leakage, training on insufficient data, and quoting a metric that was never measured.
 */
import { describe, it, expect } from 'vitest';
import {
  DECISION_LABELS, DECISION_RELEVANCE, BUSINESS_OUTCOMES, CALLER_FORBIDDEN_FIELDS,
  normaliseDecisionAction, PHASE8_SCHEMA_VERSION,
} from '../src/learning/contract.js';
import {
  assembleTrainingRows, computeCorpusStats, datasetVersion, temporalGroupSplit,
  type RawDecisionEvent,
} from '../src/learning/dataset.js';
import {
  DEFAULT_THRESHOLDS, assertTrainingPermitted, evaluateSufficiency, type CorpusStats,
} from '../src/learning/sufficiency.js';
import {
  assertSourcePermitted, globalAuthorizedScope, rejectCallerTenant, singleTenantScope,
  tenantFromToken, verifyTenantIsolation,
} from '../src/learning/tenantGuard.js';
import {
  isPromotable, validateEvaluationRecord, EVALUATION_RECORD_VERSION,
  type ModelEvaluationRecord,
} from '../src/learning/evaluationRecord.js';
import { DRIFT_DEFINITIONS, evaluateDrift, populationStabilityIndex } from '../src/learning/drift.js';
import { LABEL_SOURCES, ELIGIBLE_SOURCES } from '../src/learning/labelSources.js';

const ev = (o: Partial<RawDecisionEvent>): RawDecisionEvent => ({
  event_id: 1, tenant_id: 'tenant-1', job_id: 10, candidate_id: 100,
  action: 1, event_timestamp: '2026-08-01T00:00:00.000Z', ...o,
});
const T1 = singleTenantScope('tenant-1');

// ============================================================ label policy
describe('label policy', () => {
  it('keeps decision labels and business outcomes as disjoint vocabularies', () => {
    for (const d of DECISION_LABELS) {
      expect(BUSINESS_OUTCOMES as readonly string[]).not.toContain(d);
    }
  });

  it('uses the same ordinal grades as the existing LTR so the two cannot disagree', () => {
    expect(DECISION_RELEVANCE).toEqual({ REJECT: 0, SAVE: 1, ACCEPT: 2 });
  });

  it('normalises the postgres numeric encoding actually present in the database', () => {
    // node-postgres returns `numeric` as a string: "0.0" / "0.5" / "1.0".
    expect(normaliseDecisionAction('0.0')).toBe('REJECT');
    expect(normaliseDecisionAction('0.5')).toBe('SAVE');
    expect(normaliseDecisionAction('1.0')).toBe('ACCEPT');
    expect(normaliseDecisionAction(0)).toBe('REJECT');
    expect(normaliseDecisionAction(1)).toBe('ACCEPT');
  });

  it('returns null for unrecognised actions rather than coercing to a grade', () => {
    for (const bad of [null, undefined, '', 'accept', 2, -1, 0.7, NaN, {}]) {
      expect(normaliseDecisionAction(bad as unknown)).toBeNull();
    }
  });
});

// ============================================================ assembly
describe('dataset assembly', () => {
  it('drops rows missing any identity field rather than defaulting them', () => {
    const r = assembleTrainingRows([
      ev({ tenant_id: null }), ev({ event_id: null }), ev({ job_id: null }),
      ev({ candidate_id: null }), ev({ event_timestamp: null }),
    ], T1);
    expect(r.rows).toHaveLength(0);
    expect(r.droppedMissingIdentity).toBe(5);
  });

  it('drops replayed events by event_id', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1 }), ev({ event_id: 1 }), ev({ event_id: 1 }),
    ], T1);
    expect(r.droppedReplay).toBe(2);
    expect(r.rows).toHaveLength(1);
  });

  it('collapses duplicate decisions on one pair to a single row', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1, action: 0, event_timestamp: '2026-08-01T00:00:00.000Z' }),
      ev({ event_id: 2, action: 1, event_timestamp: '2026-08-02T00:00:00.000Z' }),
    ], T1);
    expect(r.rows).toHaveLength(1);
    expect(r.supersededByConflictPolicy).toBe(1);
    expect(r.conflictingPairs).toBe(1);
  });

  it('LATEST_WINS keeps the most recent decision, not the first', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1, action: 1, event_timestamp: '2026-08-01T00:00:00.000Z' }),
      ev({ event_id: 2, action: 0, event_timestamp: '2026-08-05T00:00:00.000Z' }),
    ], T1);
    expect(r.rows[0].label).toBe('REJECT');
    expect(r.rows[0].superseded_event_ids).toEqual(['1']);
  });

  it('drops a pair whose conflicting decisions share a timestamp rather than guessing order', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1, action: 1, event_timestamp: '2026-08-01T00:00:00.000Z' }),
      ev({ event_id: 2, action: 0, event_timestamp: '2026-08-01T00:00:00.000Z' }),
    ], T1);
    expect(r.rows).toHaveLength(0);
    expect(r.droppedAmbiguousOrder).toBe(2);
  });

  it('orders output by event timestamp', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1, candidate_id: 1, event_timestamp: '2026-08-09T00:00:00.000Z' }),
      ev({ event_id: 2, candidate_id: 2, event_timestamp: '2026-08-02T00:00:00.000Z' }),
    ], T1);
    expect(r.rows.map((x) => x.event_id)).toEqual(['2', '1']);
  });

  it('produces a stable dataset_version for the same rows and a different one otherwise', () => {
    const a = assembleTrainingRows([ev({ event_id: 1 })], T1);
    const b = assembleTrainingRows([ev({ event_id: 1 })], T1);
    const c = assembleTrainingRows([ev({ event_id: 1, action: 0 })], T1);
    expect(datasetVersion(a.rows, T1)).toBe(datasetVersion(b.rows, T1));
    expect(datasetVersion(a.rows, T1)).not.toBe(datasetVersion(c.rows, T1));
  });
});

// ============================================================ tenant isolation
describe('tenant isolation', () => {
  it('drops foreign-tenant rows from a single-tenant set', () => {
    const r = assembleTrainingRows([
      ev({ event_id: 1, tenant_id: 'tenant-1' }),
      ev({ event_id: 2, tenant_id: 'tenant-69', candidate_id: 200 }),
      ev({ event_id: 3, tenant_id: 'tenant-71', candidate_id: 300 }),
    ], T1);
    expect(r.rows).toHaveLength(1);
    expect(r.droppedForeignTenant).toBe(2);
    expect(r.rows.every((x) => x.tenant_id === 'tenant-1')).toBe(true);
  });

  it('reports ZERO cross-tenant leakage on every single-tenant assembly', () => {
    const events = [
      ev({ event_id: 1, tenant_id: 'tenant-1' }),
      ev({ event_id: 2, tenant_id: 'tenant-69', candidate_id: 200 }),
      ev({ event_id: 3, tenant_id: 'tenant-71', candidate_id: 300 }),
    ];
    for (const t of ['tenant-1', 'tenant-69', 'tenant-71']) {
      const scope = singleTenantScope(t);
      const r = assembleTrainingRows(events, scope);
      expect(verifyTenantIsolation(r.rows, scope)).toEqual([]);
    }
  });

  it('detects a mixed-tenant set that bypassed assembly', () => {
    const v = verifyTenantIsolation(
      [{ tenant_id: 'tenant-1' }, { tenant_id: 'tenant-69' }], T1);
    expect(v.some((x) => x.kind === 'FOREIGN_TENANT_ROW')).toBe(true);
    expect(v.some((x) => x.kind === 'MIXED_TENANT_SET')).toBe(true);
  });

  it('detects rows with no tenant at all', () => {
    expect(verifyTenantIsolation([{ tenant_id: null }], T1)
      .some((x) => x.kind === 'MISSING_TENANT')).toBe(true);
  });

  it('refuses a single-tenant scope without a tenant id', () => {
    expect(() => singleTenantScope('')).toThrow();
    expect(() => singleTenantScope('   ')).toThrow();
  });

  it('refuses a global scope without a recorded authorisation', () => {
    expect(() => globalAuthorizedScope('')).toThrow();
    expect(verifyTenantIsolation([{ tenant_id: 'tenant-1' }],
      { scope: 'GLOBAL_AUTHORIZED', tenant_id: null, authorization_reference: null })
      .some((x) => x.kind === 'UNAUTHORIZED_GLOBAL')).toBe(true);
  });

  it('derives the tenant from the token and refuses when the claim is absent', () => {
    expect(tenantFromToken(7)).toBe('tenant-7');
    for (const bad of [null, undefined, '']) expect(() => tenantFromToken(bad)).toThrow();
  });

  it('rejects a caller-supplied tenant even when it matches the token', () => {
    expect(rejectCallerTenant('tenant-7', 'tenant-7')?.kind).toBe('FORGED_TENANT');
    expect(rejectCallerTenant('tenant-9', 'tenant-7')?.kind).toBe('TENANT_MISMATCH');
    expect(rejectCallerTenant(undefined, 'tenant-7')).toBeNull();
  });

  it('blocks candidate_decisions as a label source until tenant ownership exists', () => {
    expect(assertSourcePermitted('candidate_decisions')).not.toBeNull();
    expect(assertSourcePermitted('swipes')).toBeNull();
    expect(LABEL_SOURCES.find((s) => s.table === 'candidate_decisions')?.eligibility).toBe('REJECTED');
  });

  it('admits exactly one eligible label source today, and it carries a tenant column', () => {
    expect(ELIGIBLE_SOURCES).toHaveLength(1);
    expect(ELIGIBLE_SOURCES[0].table).toBe('swipes');
    expect(ELIGIBLE_SOURCES[0].tenantColumn).toBeTruthy();
  });

  it('never lets one tenant\'s labels reach another tenant\'s training set', () => {
    const events = [
      ...Array.from({ length: 20 }, (_, i) => ev({ event_id: `a${i}`, tenant_id: 'tenant-1', candidate_id: i })),
      ...Array.from({ length: 20 }, (_, i) => ev({ event_id: `b${i}`, tenant_id: 'tenant-2', candidate_id: i })),
    ];
    const a = assembleTrainingRows(events, singleTenantScope('tenant-1'));
    const b = assembleTrainingRows(events, singleTenantScope('tenant-2'));
    const aIds = new Set(a.rows.map((r) => r.event_id));
    for (const r of b.rows) expect(aIds.has(r.event_id)).toBe(false);
  });
});

// ============================================================ sufficiency gates
describe('data sufficiency gates', () => {
  const sufficientStats = (): CorpusStats => ({
    totalPairs: 800, uniqueJobs: 60, rankingGroups: 60,
    groupSizes: Array.from({ length: 60 }, () => 12),
    uniqueCandidates: 400, tenants: 5,
    rowsPerTenant: { a: 200, b: 180, c: 160, d: 140, e: 120 },
    labelCounts: { REJECT: 300, SAVE: 200, ACCEPT: 300 },
    temporalSpanDays: 200, duplicatePairs: 0, conflictingPairs: 0, missingIdentityRows: 0,
  });

  it('passes only when every gate passes', () => {
    const r = evaluateSufficiency(sufficientStats());
    expect(r.verdict).toBe('DATA_SUFFICIENT');
    expect(r.training_permitted).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('blocks training on the CURRENT real corpus shape', () => {
    // The measured corpus: 87 pairs, 8 jobs, 6 groups, 97.7% one tenant, 34-day span.
    const r = evaluateSufficiency({
      totalPairs: 87, uniqueJobs: 8, rankingGroups: 6, groupSizes: [20, 18, 16, 15, 9, 6],
      uniqueCandidates: 28, tenants: 3,
      rowsPerTenant: { 'tenant-1': 85, 'tenant-69': 1, 'tenant-71': 1 },
      labelCounts: { REJECT: 38, SAVE: 1, ACCEPT: 48 },
      temporalSpanDays: 34, duplicatePairs: 33, conflictingPairs: 7, missingIdentityRows: 0,
    });
    expect(r.verdict).toBe('DATA_INSUFFICIENT');
    expect(r.training_permitted).toBe(false);
    expect(assertTrainingPermitted(r).permitted).toBe(false);
  });

  it('evaluates every gate rather than short-circuiting on the first failure', () => {
    const r = evaluateSufficiency({
      totalPairs: 1, uniqueJobs: 1, rankingGroups: 0, groupSizes: [], uniqueCandidates: 1,
      tenants: 1, rowsPerTenant: { a: 1 }, labelCounts: { REJECT: 1, SAVE: 0, ACCEPT: 0 },
      temporalSpanDays: 0, duplicatePairs: 0, conflictingPairs: 0, missingIdentityRows: 0,
    });
    expect(r.gates.length).toBeGreaterThanOrEqual(12);
    expect(r.failed.length).toBeGreaterThan(5);
  });

  it('blocks a corpus dominated by one tenant even when the tenant COUNT passes', () => {
    const s = sufficientStats();
    s.tenants = 5;
    s.rowsPerTenant = { a: 780, b: 5, c: 5, d: 5, e: 5 };
    const r = evaluateSufficiency(s);
    expect(r.failed).toContain('tenant_balance');
  });

  it('blocks a near-degenerate label distribution', () => {
    const s = sufficientStats();
    s.labelCounts = { REJECT: 5, SAVE: 5, ACCEPT: 790 };
    expect(evaluateSufficiency(s).failed).toContain('label_diversity');
  });

  it('blocks unresolved conflicts and missing identity as hygiene failures', () => {
    const a = sufficientStats(); a.conflictingPairs = 3;
    expect(evaluateSufficiency(a).failed).toContain('no_unresolved_conflicts');
    const b = sufficientStats(); b.missingIdentityRows = 1;
    expect(evaluateSufficiency(b).failed).toContain('no_missing_identity');
  });

  it('blocks tiny ranking groups where NDCG@10 is degenerate', () => {
    const s = sufficientStats();
    s.groupSizes = [...Array.from({ length: 59 }, () => 12), 2];
    expect(evaluateSufficiency(s).failed).toContain('candidates_per_group');
  });

  it('gives every gate a stated reason', () => {
    for (const g of evaluateSufficiency(sufficientStats()).gates) {
      expect(g.reason.length).toBeGreaterThan(20);
    }
  });
});

// ============================================================ temporal split
describe('temporal split', () => {
  it('splits by group and by time, never leaking a job across folds', () => {
    const events: RawDecisionEvent[] = [];
    for (let job = 0; job < 10; job++) {
      for (let cand = 0; cand < 5; cand++) {
        events.push(ev({
          event_id: `${job}-${cand}`, job_id: job, candidate_id: cand,
          event_timestamp: new Date(Date.UTC(2026, 0, job + 1)).toISOString(),
        }));
      }
    }
    const rows = assembleTrainingRows(events, T1).rows;
    const split = temporalGroupSplit(rows);
    const jobsIn = (rs: typeof rows) => new Set(rs.map((r) => r.job_id));
    const train = jobsIn(split.train), test = jobsIn(split.test);
    for (const j of test) expect(train.has(j)).toBe(false);
  });

  it('places every test event after every training event', () => {
    const events = Array.from({ length: 30 }, (_, i) => ev({
      event_id: i, job_id: Math.floor(i / 3), candidate_id: i,
      event_timestamp: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3))).toISOString(),
    }));
    const split = temporalGroupSplit(assembleTrainingRows(events, T1).rows);
    if (split.train.length && split.test.length) {
      const lastTrain = Math.max(...split.train.map((r) => Date.parse(r.event_timestamp)));
      const firstTest = Math.min(...split.test.map((r) => Date.parse(r.event_timestamp)));
      expect(firstTest).toBeGreaterThanOrEqual(lastTrain);
    }
  });
});

// ============================================================ evaluation attribution
describe('LTR evaluation attribution', () => {
  const record = (o: Partial<ModelEvaluationRecord> = {}): ModelEvaluationRecord => ({
    evaluation_record_version: EVALUATION_RECORD_VERSION,
    model_version: 'ltr-2026-08-13T04:17:02.349Z',
    dataset_version: 'dsv1:abc', evaluation_run_id: 'run-1',
    ndcg_at_10: 0.77, map_at_10: 0.75, mrr: 0.91, precision_at_10: 0.68, recall_at_10: 0.71,
    training_examples: 115, training_groups: 6, evaluation_groups: 12,
    tenant_scope: { scope: 'SINGLE_TENANT', tenant_id: 'tenant-1', authorization_reference: null },
    evaluation_timestamp: '2026-08-13T04:48:20.499Z', feature_schema_version: 1,
    upstream: {
      jd_intelligence_version: 1, candidate_intelligence_version: 1,
      graph_fingerprint: 'sha256:84948f', evidence_engine_version: 1, match_engine_version: 1,
    },
    artifact: { artifact_hash: 'sha256:deadbeef', artifact_path: '/models/ltr/v1/xgb.joblib', immutable: true },
    ...o,
  });

  it('accepts a fully attributed record', () => {
    expect(validateEvaluationRecord(record())).toEqual([]);
    expect(isPromotable(record()).promotable).toBe(true);
  });

  it('rejects a record with no model_version - the defect that exists today', () => {
    expect(validateEvaluationRecord(record({ model_version: '' }))
      .some((i) => i.path === 'model_version')).toBe(true);
  });

  it('rejects a record with no dataset_version', () => {
    expect(validateEvaluationRecord(record({ dataset_version: '' }))
      .some((i) => i.path === 'dataset_version')).toBe(true);
  });

  it('refuses to promote a model whose NDCG was never measured', () => {
    const r = isPromotable(record({ ndcg_at_10: null }));
    expect(r.promotable).toBe(false);
    expect(r.reasons.join(' ')).toContain('never measured');
  });

  it('refuses to promote a model whose artifact can be overwritten', () => {
    // The real ranker.py writes fixed paths and overwrites them on every run.
    const r = isPromotable(record({
      artifact: { artifact_hash: null, artifact_path: '/models/xgb_ranker.joblib', immutable: false },
    }));
    expect(r.promotable).toBe(false);
    expect(r.reasons.join(' ')).toContain('not reproducible');
  });

  it('refuses to promote on a held-out fold too small to detect a regression', () => {
    expect(isPromotable(record({ evaluation_groups: 3 })).promotable).toBe(false);
  });

  it('rejects an out-of-range metric but allows null as NOT MEASURED', () => {
    expect(validateEvaluationRecord(record({ ndcg_at_10: 1.5 })).length).toBeGreaterThan(0);
    expect(validateEvaluationRecord(record({ ndcg_at_10: -0.1 })).length).toBeGreaterThan(0);
    expect(validateEvaluationRecord(record({ map_at_10: null }))).toEqual([]);
  });

  it('requires an authorisation reference on a globally trained model', () => {
    expect(validateEvaluationRecord(record({
      tenant_scope: { scope: 'GLOBAL_AUTHORIZED', tenant_id: null, authorization_reference: null },
    })).some((i) => i.path.includes('authorization_reference'))).toBe(true);
  });
});

// ============================================================ drift
describe('drift measurement', () => {
  it('defines every drift kind with a threshold and a rationale', () => {
    for (const d of DRIFT_DEFINITIONS) {
      expect(Number.isFinite(d.blockThreshold)).toBe(true);
      expect(d.rationale.length).toBeGreaterThan(20);
    }
  });

  it('blocks on a divergence at or beyond its threshold', () => {
    const r = evaluateDrift([{ kind: 'LABEL_DISTRIBUTION', value: 0.30, window: '7d', observed_at: 'now' }]);
    expect(r.blocked).toBe(true);
  });

  it('treats ranking similarity as low-is-bad, not high-is-bad', () => {
    expect(evaluateDrift([{ kind: 'RANKING', value: 0.5, window: '7d', observed_at: 'now' }]).blocked).toBe(true);
    expect(evaluateDrift([{ kind: 'RANKING', value: 0.95, window: '7d', observed_at: 'now' }]).blocked).toBe(false);
  });

  it('blocks a single-tenant-dominated training population', () => {
    expect(evaluateDrift([{ kind: 'TENANT_DISTRIBUTION', value: 0.977, window: 'all', observed_at: 'now' }])
      .blocked).toBe(true);
  });

  it('computes PSI as zero for identical distributions and positive for shifted ones', () => {
    expect(populationStabilityIndex([10, 10, 10], [10, 10, 10])).toBeCloseTo(0, 6);
    expect(populationStabilityIndex([10, 10, 10], [30, 5, 1])).toBeGreaterThan(0.1);
  });
});

// ============================================================ security surface
describe('security contract', () => {
  it('forbids the caller from supplying any authoritative learning field', () => {
    for (const f of ['tenant_id', 'label', 'learned_score', 'model_version', 'dataset_version',
      'learned_confidence', 'insufficient_data', 'result_hash']) {
      expect(CALLER_FORBIDDEN_FIELDS).toContain(f);
    }
  });

  it('pins the Phase 8 schema version', () => {
    expect(PHASE8_SCHEMA_VERSION).toBe(1);
  });
});

// ============================================================ determinism
describe('determinism', () => {
  it('produces an identical dataset fingerprint over three identical runs', () => {
    const events = Array.from({ length: 40 }, (_, i) => ev({
      event_id: i, job_id: i % 5, candidate_id: i,
      action: [0, 0.5, 1][i % 3],
      event_timestamp: new Date(Date.UTC(2026, 0, 1 + (i % 20))).toISOString(),
    }));
    const hashes = new Set([0, 1, 2].map(() => {
      const r = assembleTrainingRows(events, T1);
      return datasetVersion(r.rows, T1);
    }));
    expect(hashes.size).toBe(1);
  });

  it('produces identical corpus stats over three identical runs', () => {
    const events = Array.from({ length: 40 }, (_, i) => ev({
      event_id: i, job_id: i % 5, candidate_id: i,
      event_timestamp: new Date(Date.UTC(2026, 0, 1 + (i % 20))).toISOString(),
    }));
    const shapes = new Set([0, 1, 2].map(() => {
      const r = assembleTrainingRows(events, T1);
      return JSON.stringify(computeCorpusStats(r.rows, DEFAULT_THRESHOLDS.minCandidatesPerGroup, r));
    }));
    expect(shapes.size).toBe(1);
  });
});
