/**
 * Phase 7 metrics on the service's existing Prometheus registry.
 *
 * CARDINALITY RULE (§41): every label is drawn from a closed enum in contract.ts - satisfaction
 * state, semantic route, alignment, gap kind. candidate_id, job_id, tenant_id, raw JD text and raw
 * candidate text are never labels; any of them would turn a counter into an unbounded time-series
 * family and leak PII into the metrics store.
 *
 * The score histogram is bucketed, not labelled, for the same reason.
 */
import { Counter, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const semanticMatchAttempts = new Counter({
  name: 'semantic_match_attempts_total',
  help: 'Phase 7 match intelligence requests received',
  registers: [registry],
});

export const semanticMatchSuccess = new Counter({
  name: 'semantic_match_success_total',
  help: 'Match profiles produced and validated',
  registers: [registry],
});

export const semanticMatchFailure = new Counter({
  name: 'semantic_match_failure_total',
  help: 'Match evaluations that failed, by reason',
  labelNames: ['reason'] as const,   // bad_request | too_large | validation | internal_error
  registers: [registry],
});

export const semanticMatchLatency = new Histogram({
  name: 'semantic_match_latency_seconds',
  help: 'Wall time to build one match intelligence profile',
  buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

/** Requirement outcomes. Closed enum: SATISFACTION_STATES. */
export const semanticMatchRequirement = new Counter({
  name: 'semantic_match_requirement_total',
  help: 'Requirement outcomes produced, by satisfaction state',
  labelNames: ['state'] as const,
  registers: [registry],
});

/** How requirements were reached. Closed enum: SEMANTIC_ROUTES. */
export const semanticMatchRoute = new Counter({
  name: 'semantic_match_route_total',
  help: 'Requirement outcomes, by the semantic route that reached them',
  labelNames: ['route'] as const,
  registers: [registry],
});

export const semanticMatchGap = new Counter({
  name: 'semantic_match_gap_total',
  help: 'Gaps reported, by kind',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export const semanticMatchConflict = new Counter({
  name: 'semantic_match_conflict_total',
  help: 'JD-vs-candidate contradictions detected, by kind',
  labelNames: ['kind'] as const,     // REQUIREMENT_DENIED | RELEVANCE_CONFLICT
  registers: [registry],
});

export const semanticMatchValidationFailure = new Counter({
  name: 'semantic_match_validation_failure_total',
  help: 'Match profiles rejected by the policy validator',
  registers: [registry],
});

/**
 * Score distribution. A histogram rather than a gauge so a shift in the shape of the population is
 * visible - a sudden mass at the top is what a false-positive regression looks like in production.
 */
export const semanticMatchScore = new Histogram({
  name: 'semantic_match_score_distribution',
  help: 'Distribution of Phase 7 overall_fit scores (shadow only; not a production ranking signal)',
  buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  registers: [registry],
});

/** Profiles that could not be scored meaningfully because too much was UNKNOWN. */
export const semanticMatchInsufficient = new Counter({
  name: 'semantic_match_insufficient_data_total',
  help: 'Match profiles flagged insufficient_data',
  registers: [registry],
});
