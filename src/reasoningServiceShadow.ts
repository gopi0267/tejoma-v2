/**
 * Shadow-validation for Matching Reasoning Service (Batch 26), following the exact same
 * discipline as src/shadowRead.ts/src/jdParserShadow.ts/src/candidateShadow.ts (Phase 11 section
 * 12's methodology). Different shape from those three: this isn't a request-triggered re-fetch of
 * something a real user just asked for - computeReasoningForCandidate/ForJob already run in the
 * background (fire-and-forget from candidate.routes.ts/job.routes.ts), so there is no user-facing
 * response to piggyback a shadow call onto. Instead, this module is a drop-in replacement for the
 * two exported functions candidate.routes.ts/job.routes.ts already call
 * (computeReasoningForCandidateInBackground/computeReasoningForJobInBackground) - same names, same
 * signatures, same real local computation (the unchanged, ported originals in
 * matching/reasoning/computeReasoning.ts), with an ADDITIONAL shadow comparison against
 * matching-reasoning-service bolted on only when enabled. The monolith's own local computation and
 * storage is completely unaffected either way - see computeReasoning.ts's own header comment for
 * why nothing here is wired into live scoring.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_REASONING_ENABLED must be exactly 'true').
 *   2. Never affects real behavior - the monolith's own computeReasoningForCandidate/ForJob call
 *      and its db.replaceReasoningConclusions write happen exactly as they always have, whether or
 *      not the shadow comparison runs afterward.
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';
import { computeReasoningForCandidate, computeReasoningForJob } from './matching/reasoning/computeReasoning.js';
import type { ProjectEntry, ReasoningConclusion } from './types.js';

export const SHADOW_REASONING_ENABLED = process.env.SHADOW_REASONING_ENABLED === 'true';

const MATCHING_REASONING_SERVICE_URL = process.env.MATCHING_REASONING_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 10000;

// id/subject_type/subject_id/created_at legitimately differ between the two databases (different
// auto-increment ids, different insert timestamps) - only these content fields are a real
// correctness signal. Order-independent (a set of facts, not a sequence), so compared as a sorted
// set, not by array position.
const COMPARABLE_FIELDS = ['conclusion_text', 'conclusion_type', 'reasoning_type', 'evidence_chain', 'conclusion_confidence', 'confidence_derivation', 'derived_from'] as const;

function canonicalize(conclusions: Array<Record<string, unknown>>): string[] {
  return conclusions.map((c) => JSON.stringify(COMPARABLE_FIELDS.map((f) => c[f]))).sort();
}

async function shadowCompare(
  endpoint: 'compute-for-candidate' | 'compute-for-job',
  body: Record<string, unknown>,
  subjectId: number,
  monolithConclusions: ReasoningConclusion[]
): Promise<void> {
  if (!MATCHING_REASONING_SERVICE_URL) {
    logger.warn('SHADOW_REASONING_ENABLED is true but MATCHING_REASONING_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${MATCHING_REASONING_SERVICE_URL}/internal/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, subjectId, endpoint }, 'Shadow-validation call to matching-reasoning-service returned a non-OK status - comparison skipped');
      return;
    }

    const responseBody = (await response.json()) as { conclusions: ReasoningConclusion[] };
    const monolithSet = canonicalize(monolithConclusions as unknown as Array<Record<string, unknown>>);
    const serviceSet = canonicalize((responseBody.conclusions || []) as unknown as Array<Record<string, unknown>>);

    if (JSON.stringify(monolithSet) !== JSON.stringify(serviceSet)) {
      logger.error(
        { subjectId, endpoint, monolithCount: monolithSet.length, serviceCount: serviceSet.length, monolith: monolithSet, matchingReasoningService: serviceSet },
        'SHADOW-VALIDATION DIVERGENCE: monolith and matching-reasoning-service computed different reasoning conclusions'
      );
      return;
    }

    logger.debug({ subjectId, endpoint }, 'Shadow-validation agreement: matching-reasoning-service matched the monolith for this subject');
  } catch (error: any) {
    logger.warn({ err: error?.message, subjectId, endpoint }, 'Shadow-validation call to matching-reasoning-service failed - comparison skipped');
  }
}

/** Drop-in replacement for matching/reasoning/computeReasoning.ts's own computeReasoningForCandidateInBackground - same signature, same real local computation, plus an optional shadow comparison. */
export function computeReasoningForCandidateInBackground(
  candidateId: number,
  skills: string[] | null | undefined,
  projectEntries: ProjectEntry[] | null | undefined
): void {
  computeReasoningForCandidate(candidateId, skills, projectEntries)
    .then((conclusions) => {
      if (SHADOW_REASONING_ENABLED) {
        shadowCompare('compute-for-candidate', { candidateId, skills, projectEntries }, candidateId, conclusions);
      }
    })
    .catch((err) => logger.warn({ err: err.message, candidateId }, 'Reasoning Layer computation failed for candidate'));
}

/** Drop-in replacement for matching/reasoning/computeReasoning.ts's own computeReasoningForJobInBackground - same signature, same real local computation, plus an optional shadow comparison. */
export function computeReasoningForJobInBackground(jobId: number, requiredSkills: string[] | null | undefined, optionalSkills: string[] | null | undefined): void {
  computeReasoningForJob(jobId, requiredSkills, optionalSkills)
    .then((conclusions) => {
      if (SHADOW_REASONING_ENABLED) {
        shadowCompare('compute-for-job', { jobId, requiredSkills, optionalSkills }, jobId, conclusions);
      }
    })
    .catch((err) => logger.warn({ err: err.message, jobId }, 'Reasoning Layer computation failed for job'));
}
