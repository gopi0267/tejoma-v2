/**
 * Phase 8 metrics on the service's existing Prometheus registry.
 *
 * CARDINALITY RULE: every label is a closed enum from contract.ts / drift.ts / tenantGuard.ts.
 * candidate_id, job_id, tenant_id, raw JD text and raw candidate text are never labels - a
 * tenant_id label would leak customer identity into the metrics store and turn each counter into
 * an unbounded time-series family.
 *
 * phase8_cross_tenant_guard_total is the metric that matters operationally: it must remain 0. A
 * non-zero value means an assembled training or evaluation set contained a row belonging to
 * someone else, which is a customer-data incident rather than a quality regression.
 */
import { Counter, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const phase8Attempts = new Counter({
  name: 'phase8_attempts_total',
  help: 'Phase 8 evaluations attempted',
  registers: [registry],
});

export const phase8Success = new Counter({
  name: 'phase8_success_total',
  help: 'Phase 8 evaluations that produced a validated result',
  registers: [registry],
});

export const phase8Failure = new Counter({
  name: 'phase8_failure_total',
  help: 'Phase 8 evaluations that failed, by reason',
  labelNames: ['reason'] as const,   // bad_request | too_large | validation | internal_error
  registers: [registry],
});

export const phase8InsufficientData = new Counter({
  name: 'phase8_insufficient_data_total',
  help: 'Results returned with no learned score because a sufficiency gate was closed',
  labelNames: ['gate'] as const,     // closed enum: the gate names in sufficiency.ts
  registers: [registry],
});

export const phase8ValidationFailure = new Counter({
  name: 'phase8_validation_failure_total',
  help: 'Phase 8 results or evaluation records rejected by their validator',
  registers: [registry],
});

export const phase8ModelInference = new Counter({
  name: 'phase8_model_inference_total',
  help: 'Learned-model inferences performed. Expected to remain 0 while the gate is closed.',
  labelNames: ['outcome'] as const,  // served | skipped_gate_closed | model_unavailable
  registers: [registry],
});

export const phase8RankingChange = new Counter({
  name: 'phase8_ranking_change_total',
  help: 'Ordering changes the learned layer would apply, by direction (shadow-only)',
  labelNames: ['direction'] as const, // up | down | unchanged
  registers: [registry],
});

/** THE SAFETY COUNTER. Must remain 0. Any increment is a customer-data incident. */
export const phase8CrossTenantGuard = new Counter({
  name: 'phase8_cross_tenant_guard_total',
  help: 'Rows or requests blocked by the tenant-isolation guard, by violation kind',
  labelNames: ['kind'] as const,     // closed enum: TenantViolation['kind']
  registers: [registry],
});

export const phase8Latency = new Histogram({
  name: 'phase8_latency_seconds',
  help: 'Wall time to produce one Phase 8 result',
  buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

/** Drift observations, by kind and whether they breached the block threshold. */
export const phase8Drift = new Counter({
  name: 'phase8_drift_observation_total',
  help: 'Drift observations recorded, by kind and verdict',
  labelNames: ['kind', 'verdict'] as const,   // kind: DriftKind, verdict: within|blocked
  registers: [registry],
});
