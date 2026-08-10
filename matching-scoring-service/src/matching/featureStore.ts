// Ported from the monolith's src/matching/featureStore.ts, unchanged logic - now writing to this
// service's own, really-owned match_features table (see db.ts's header comment for why this is a
// safe full cutover, not a mirror).
//
// Activates match_features the same way the monolith's original always did: write-through logging
// from rankCandidatesForJob's persist path, storing the EXACT 8-dimensional vector (see
// FEATURE_NAMES in python-services/matching-ml-service/ensemble.py) each 'full'-tier score was
// computed from. Nothing reads this table back - see the monolith's own module doc for why.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import type { Job, MatchFeatureRecord } from '../types.js';
import type { MatchWeighting, MatchTier } from './matchingApi.js';
import type { MatchScoreResult } from './services.js';

export const FEATURE_SCHEMA_VERSION = 1;

// Mirrors FEATURE_NAMES in python-services/matching-ml-service/ensemble.py exactly - order
// matters, this is how the 8-element array is unpacked into named columns.
export function buildFeatureRecord(params: {
  companyId: number;
  jobId: number;
  candidateId: number;
  featureVector: number[];
  weighting: MatchWeighting;
  tier: MatchTier;
  modelVersion: string | null;
  source: string;
}): Omit<MatchFeatureRecord, 'id' | 'computed_at'> | null {
  const { featureVector } = params;
  if (!Array.isArray(featureVector) || featureVector.length !== 8) {
    return null;
  }
  const [
    jaccard_skill_score, cosine_text_score, cosine_bert_score, euclidean_feature_score,
    experience_score, location_score, salary_score, levenshtein_title_score,
  ] = featureVector;

  return {
    company_id: params.companyId,
    job_id: params.jobId,
    candidate_id: params.candidateId,
    feature_schema_version: FEATURE_SCHEMA_VERSION,
    jaccard_skill_score, cosine_text_score, cosine_bert_score, euclidean_feature_score,
    experience_score, location_score, salary_score, levenshtein_title_score,
    weighting: params.weighting,
    tier: params.tier,
    model_version: params.modelVersion,
    source: params.source,
  };
}

export async function persistMatchFeatures(params: {
  companyId: number;
  job: Job;
  weighting: MatchWeighting;
  tier: MatchTier;
  modelVersion: string | null;
  source: string;
  entries: Array<{ candidateId: number | undefined; score: MatchScoreResult | undefined }>;
}): Promise<void> {
  if (!params.job.id) return;

  const writes = params.entries.map((entry) => {
    if (!entry.candidateId || !entry.score?.feature_vector) return Promise.resolve(null);
    const record = buildFeatureRecord({
      companyId: params.companyId,
      jobId: params.job.id!,
      candidateId: entry.candidateId,
      featureVector: entry.score.feature_vector,
      weighting: params.weighting,
      tier: params.tier,
      modelVersion: params.modelVersion,
      source: params.source,
    });
    if (!record) return Promise.resolve(null);
    return db.saveMatchFeatures(record);
  });

  const results = await Promise.allSettled(writes);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn({ failed, jobId: params.job.id }, 'Some match_features writes failed');
  }
}
