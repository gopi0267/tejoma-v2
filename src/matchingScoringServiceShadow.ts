/**
 * Shadow-validation for Matching Scoring Service (full-migration continuation - live-scoring-engine
 * extraction), following the exact same discipline as src/reasoningServiceShadow.ts (Batch 26).
 * calculateMatchScoresBatch/calculateMatchScoresForJobsBatch (src/matching/services.ts) already run
 * the real, live computation and return a result to their caller before this module is ever
 * invoked - this is a fire-and-forget comparison bolted on AFTER the real result exists, never a
 * replacement for it and never on the response's critical path.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_SCORING_ENABLED must be exactly 'true').
 *   2. Never affects real behavior - the monolith's own calculateMatchScoresBatch/
 *      calculateMatchScoresForJobsBatch computation and its callers' use of the result are
 *      completely unaffected whether or not this comparison runs, or what it finds.
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 *   4. Gemini summary text is deliberately excluded from the comparison (matching-scoring-service
 *      never calls Gemini - see its README) - only the numeric scoring fields are a real
 *      correctness signal.
 */
import { logger } from './utils/logger.js';
import type { Candidate, Job } from './types.js';
import type { MatchScoreResult } from './matching/services.js';

export const SHADOW_SCORING_ENABLED = process.env.SHADOW_SCORING_ENABLED === 'true';

const MATCHING_SCORING_SERVICE_URL = process.env.MATCHING_SCORING_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 15000;

// id-independent, order-independent numeric comparison - only the scores/breakdown sub-scores are
// a real correctness signal (summary text is never compared - see header comment).
function canonicalizeResult(r: MatchScoreResult): string {
  return JSON.stringify({
    feature_score: r.feature_score,
    embedding_score: r.embedding_score,
    ml_score: r.ml_score,
    final_score: r.final_score,
    skills: r.breakdown.skills.score,
    experience: r.breakdown.experience.score,
    location: r.breakdown.location.score,
    salary: r.breakdown.salary.score,
  });
}

function diffSummary(monolith: MatchScoreResult[], service: MatchScoreResult[]): { agree: boolean; mismatchCount: number } {
  if (monolith.length !== service.length) return { agree: false, mismatchCount: Math.max(monolith.length, service.length) };
  let mismatchCount = 0;
  for (let i = 0; i < monolith.length; i++) {
    if (canonicalizeResult(monolith[i]) !== canonicalizeResult(service[i])) mismatchCount++;
  }
  return { agree: mismatchCount === 0, mismatchCount };
}

async function postAndCompare(
  endpoint: 'score/candidates-batch' | 'score/jobs-batch',
  body: Record<string, unknown>,
  jobId: number,
  monolithResults: MatchScoreResult[]
): Promise<void> {
  if (!MATCHING_SCORING_SERVICE_URL) {
    logger.warn('SHADOW_SCORING_ENABLED is true but MATCHING_SCORING_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${MATCHING_SCORING_SERVICE_URL}/internal/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, jobId, endpoint }, 'Shadow-validation call to matching-scoring-service returned a non-OK status - comparison skipped');
      return;
    }

    const responseBody = (await response.json()) as { results: MatchScoreResult[] };
    const { agree, mismatchCount } = diffSummary(monolithResults, responseBody.results || []);

    if (!agree) {
      logger.error(
        { jobId, endpoint, mismatchCount, subjectCount: monolithResults.length },
        'SHADOW-VALIDATION DIVERGENCE: monolith and matching-scoring-service computed different match scores'
      );
      return;
    }

    logger.debug({ jobId, endpoint, subjectCount: monolithResults.length }, 'Shadow-validation agreement: matching-scoring-service matched the monolith for this request');
  } catch (error: any) {
    logger.warn({ err: error?.message, jobId, endpoint }, 'Shadow-validation call to matching-scoring-service failed - comparison skipped');
  }
}

/** Fire-and-forget shadow comparison for calculateMatchScoresBatch - never awaited by its caller. */
export function shadowCompareCandidatesBatch(job: Job, candidates: Candidate[], modelType: string, monolithResults: MatchScoreResult[]): void {
  if (!SHADOW_SCORING_ENABLED) return;
  postAndCompare('score/candidates-batch', { job, candidates, modelType }, job.id, monolithResults).catch((err) =>
    logger.warn({ err: err?.message, jobId: job.id }, 'Matching Scoring Service shadow comparison failed')
  );
}

/** Fire-and-forget shadow comparison for calculateMatchScoresForJobsBatch - never awaited by its caller. */
export function shadowCompareJobsBatch(candidate: Candidate, jobs: Job[], modelType: string, monolithResults: MatchScoreResult[]): void {
  if (!SHADOW_SCORING_ENABLED) return;
  postAndCompare('score/jobs-batch', { candidate, jobs, modelType }, jobs[0]?.id ?? 0, monolithResults).catch((err) =>
    logger.warn({ err: err?.message, candidateId: candidate.id }, 'Matching Scoring Service shadow comparison failed')
  );
}
