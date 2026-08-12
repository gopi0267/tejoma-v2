/**
 * Batch feature-vector scoring via matching-scoring-service, replacing
 * monolithClient.scoreBatch (the "live scoring engine remains monolith-owned" assumption in
 * learningToRank.ts's header - obsolete since Step 1 extracted that engine).
 *
 * matching-scoring-service owns calculateMatchScoresBatch outright and already exposes it as
 * POST /internal/rank-candidates-for-job, whose RankedCandidate carries the full MatchScoreResult
 * (including feature_vector) in `.score`. No new endpoint was added.
 *
 * ORDERING - the subtle part. rankCandidatesForJob SORTS its result by match_score descending,
 * while the monolith's scoreBatch returned results in input order and learningToRank matched
 * relevance labels POSITIONALLY (relevanceByIndex[i]). Consuming the ranked array positionally
 * would therefore attach each candidate's relevance grade to a DIFFERENT candidate's feature
 * vector - silently training the ranker on mislabelled data, with no error anywhere. This client
 * returns a candidateId -> feature_vector map instead, so callers align by identity and the
 * upstream sort cannot corrupt labels.
 *
 * `persist` is deliberately omitted: training must not write match_scores/match_features rows as a
 * side effect. `tier: 'full'` is required - the 'heuristic' tier skips calculateMatchScoresBatch
 * entirely and returns no feature vectors.
 */
import { MATCHING_SCORING_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 60000;

export async function scoreBatchFeatureVectors(
  job: unknown,
  candidates: Array<{ id: number }>
): Promise<Map<number, number[]>> {
  const byCandidateId = new Map<number, number[]>();
  if (candidates.length === 0) return byCandidateId;

  try {
    const res = await fetch(`${MATCHING_SCORING_SERVICE_URL}/internal/rank-candidates-for-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, candidates, tier: 'full' }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'matching-scoring-service returned non-ok status for rank-candidates-for-job');
      return byCandidateId;
    }
    const body: any = await res.json().catch(() => ({}));
    for (const entry of (body?.ranked ?? []) as Array<{ candidate?: { id?: number }; score?: { feature_vector?: number[] } }>) {
      const id = entry?.candidate?.id;
      const fv = entry?.score?.feature_vector;
      if (typeof id === 'number' && Array.isArray(fv)) byCandidateId.set(id, fv);
    }
    return byCandidateId;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Failed to score batch via matching-scoring-service');
    return byCandidateId;
  }
}
