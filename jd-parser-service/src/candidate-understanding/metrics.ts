/**
 * Phase 4 metrics on the service's existing Prometheus registry.
 *
 * Cardinality is bounded by construction: `assertion` has 6 values, `depth` 7, `type` a closed
 * enum. candidate_id, tenant, resume text and raw errors are NEVER labels - a candidate_id label
 * would add one time series per candidate forever, and resume text as a label would put PII into
 * the metrics store.
 */
import { Counter, Histogram } from 'prom-client';
import { registry } from '../utils/metrics.js';

export const candidateUnderstandingAttempts = new Counter({
  name: 'candidate_understanding_attempts_total',
  help: 'Candidate understanding runs started',
  registers: [registry],
});

export const candidateUnderstandingSuccess = new Counter({
  name: 'candidate_understanding_success_total',
  help: 'Runs that produced a valid profile',
  registers: [registry],
});

export const candidateUnderstandingFailure = new Counter({
  name: 'candidate_understanding_failure_total',
  help: 'Runs that failed',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const candidateValidationFailure = new Counter({
  name: 'candidate_validation_failure_total',
  help: 'Profiles rejected by schema/provenance/span validation',
  labelNames: ['problem'] as const,
  registers: [registry],
});

export const candidateUnderstandingLatency = new Histogram({
  name: 'candidate_understanding_latency_seconds',
  help: 'Wall time to build one Candidate Intelligence Profile',
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

/** Distribution of skill units per profile, split by how the claim was asserted. */
export const candidateSkillUnits = new Counter({
  name: 'candidate_skill_units_total',
  help: 'Skill units emitted, by assertion type',
  labelNames: ['assertion'] as const,
  registers: [registry],
});

export const candidateEvidenceUnits = new Counter({
  name: 'candidate_evidence_units_total',
  help: 'Skill units emitted, by evidence strength',
  labelNames: ['strength'] as const,
  registers: [registry],
});

export const candidateAmbiguityTotal = new Counter({
  name: 'candidate_ambiguity_total',
  help: 'Ambiguities detected',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const candidateContradictionTotal = new Counter({
  name: 'candidate_contradiction_total',
  help: 'Contradictions detected',
  labelNames: ['type'] as const,
  registers: [registry],
});

/**
 * The safety metric. Increments when units were built and then rejected because their provenance
 * did not survive validation - i.e. the engine tried to assert something it could not cite. Should
 * remain flat at zero; any movement is a defect.
 */
export const candidateInferenceRejected = new Counter({
  name: 'candidate_inference_rejected_total',
  help: 'Intelligence units rejected for unverifiable provenance',
  labelNames: ['stage'] as const,
  registers: [registry],
});
