/**
 * Phase 6 metrics on the service's existing Prometheus registry.
 *
 * CARDINALITY RULE (brief §40): every label below is drawn from a closed enum declared in
 * contract.ts - evidence state, gap kind, evidence type, guard kind. candidate_id, job_id, tenant_id,
 * raw resume text and raw requirement text are never labels. A tenant_id label would leak customer
 * identity into the metrics store, and requirement text is unbounded by construction, so either one
 * would turn a counter into an unbounded time-series family.
 *
 * The guard counters are the ones that matter operationally: evidence_false_attribution_guard_total
 * incrementing at all means the engine built a unit its own hierarchy forbids, which is the failure
 * this phase exists to prevent.
 */
import { Counter, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const evidenceEvaluation = new Counter({
  name: 'evidence_evaluation_total',
  help: 'Evidence evaluation requests received',
  registers: [registry],
});

export const evidenceEvaluationSuccess = new Counter({
  name: 'evidence_evaluation_success_total',
  help: 'Evidence evaluations that produced a validated assessment',
  registers: [registry],
});

export const evidenceEvaluationFailure = new Counter({
  name: 'evidence_evaluation_failure_total',
  help: 'Evidence evaluations that failed, by reason',
  labelNames: ['reason'] as const,   // bad_request | too_large | validation | internal_error
  registers: [registry],
});

export const evidenceEvaluationLatency = new Histogram({
  name: 'evidence_evaluation_latency_seconds',
  help: 'Wall time to evaluate one JD x candidate pair',
  buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

/** Requirement outcomes, by evidence state. Closed enum: EVIDENCE_STATES. */
export const evidenceState = new Counter({
  name: 'evidence_state_total',
  help: 'Requirement assessments produced, by evidence state',
  labelNames: ['state'] as const,
  registers: [registry],
});

/** Gaps reported, by kind. Closed enum: EvidenceGap['kind']. */
export const evidenceGap = new Counter({
  name: 'evidence_gap_total',
  help: 'Evidence gaps reported, by gap kind',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export const evidenceUnits = new Counter({
  name: 'evidence_units_total',
  help: 'Evidence units attributed, by evidence type',
  labelNames: ['evidence_type'] as const,
  registers: [registry],
});

export const evidenceConflict = new Counter({
  name: 'evidence_conflict_total',
  help: 'Evidence conflicts detected, by severity',
  labelNames: ['severity'] as const,
  registers: [registry],
});

/**
 * THE SAFETY COUNTER. Increments only when validateAssessment finds a unit claiming professional or
 * production status its evidence type cannot carry, or an academic unit claiming professional
 * status. A non-zero rate here is a hard incident, not a warning: it means the engine attributed
 * experience the candidate never evidenced.
 */
export const evidenceFalseAttributionGuard = new Counter({
  name: 'evidence_false_attribution_guard_total',
  help: 'Units blocked by the false-attribution guard, by guard kind',
  labelNames: ['guard'] as const,    // professional | production | academic_professional | indirect_derivation
  registers: [registry],
});

export const evidenceValidationFailure = new Counter({
  name: 'evidence_validation_failure_total',
  help: 'Assessments rejected by schema or provenance validation',
  registers: [registry],
});
