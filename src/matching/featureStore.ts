// Enterprise AI Matching Architecture, Phase 3 - Feature Store.
//
// Activates a new, previously-nonexistent table (match_features) the same way Phase 0 activated
// match_scores: write-through logging from the Unified Matching API's existing persist path (see
// matchingApi.ts's persistCandidateMatchScores, which this module runs alongside). Stores the
// EXACT 8-dimensional vector (see FEATURE_NAMES in
// python-services/matching-ml-service/ensemble.py) each 'full'-tier score was computed from,
// plus metadata (weighting/tier/model_version/source) and a computed_at timestamp - the
// point-in-time anchor a future training job needs to reuse this exact vector instead of
// recomputing features from candidate/job rows that may have since changed (training-serving
// skew). Read-through is deliberately not implemented this phase, mirroring match_scores'
// same restriction - see matchingApi.ts's module doc for why.
//
// THIS MODULE DOES NOT CHANGE ANY EXISTING SCORING BEHAVIOR. It only writes a new, additive
// table; nothing in this file is read by any live matching/ranking code path yet.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import type { Job, MatchFeatureRecord } from '../types.js';
import type { MatchWeighting, MatchTier } from './matchingApi.js';
import type { MatchScoreResult } from '../services.js';

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
    // Never guess at missing dimensions - a malformed vector is simply not persisted.
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

// One row per candidate with a scoreable result and a real id (same real-candidates-row
// restriction persistCandidateMatchScores already applies to match_scores - a synthetic
// candidate_accounts-derived object has no candidates.id to satisfy match_features' FK either).
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
