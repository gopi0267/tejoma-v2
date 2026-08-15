/**
 * Phase 3 metrics. Registered on the service's existing Prometheus registry - no second monitoring
 * stack, consistent with how every other Tejoma service is instrumented.
 *
 * Label cardinality is bounded by construction. `outcome` has three values and `reason` is drawn
 * from a closed set of validator problems. Job ids, JD text and raw error strings are NEVER labels;
 * they live in structured logs where unbounded values are harmless. A single job_id label on a
 * counter would add one time series per job forever.
 */
import { Counter, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const jdUnderstandingAttempts = new Counter({
  name: 'jd_understanding_attempts_total',
  help: 'JD understanding runs started',
  registers: [registry],
});

export const jdUnderstandingSuccess = new Counter({
  name: 'jd_understanding_success_total',
  help: 'JD understanding runs that produced a valid profile',
  registers: [registry],
});

export const jdUnderstandingFailure = new Counter({
  name: 'jd_understanding_failure_total',
  help: 'JD understanding runs that failed',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const jdValidationFailure = new Counter({
  name: 'jd_validation_failure_total',
  help: 'Profiles rejected by schema/provenance/span validation',
  labelNames: ['problem'] as const,
  registers: [registry],
});

export const jdUnderstandingLatency = new Histogram({
  name: 'jd_understanding_latency_seconds',
  help: 'Wall time to build one Job Intelligence Profile',
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});

/** Distributions, not gauges: these describe each profile, and a gauge would only keep the last. */
export const jdRequirementCount = new Histogram({
  name: 'jd_requirement_count',
  help: 'Requirements per profile',
  buckets: [0, 1, 2, 5, 10, 20, 50, 100, 200],
  registers: [registry],
});

export const jdAmbiguityTotal = new Counter({
  name: 'jd_ambiguity_total',
  help: 'Ambiguities detected',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const jdContradictionTotal = new Counter({
  name: 'jd_contradiction_total',
  help: 'Contradictions detected',
  labelNames: ['type'] as const,
  registers: [registry],
});

/**
 * The safety metric. Increments when a unit was built but then rejected because its provenance did
 * not survive validation - i.e. the engine tried to assert something it could not cite. It should
 * sit flat at zero in production; any movement is a defect, not noise.
 */
export const jdInferenceRejected = new Counter({
  name: 'jd_inference_rejected_total',
  help: 'Intelligence units rejected for unverifiable provenance',
  labelNames: ['stage'] as const,
  registers: [registry],
});
