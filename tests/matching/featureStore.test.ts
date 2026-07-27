import { describe, it, expect } from 'vitest';
import { buildFeatureRecord, FEATURE_SCHEMA_VERSION } from '../../src/matching/featureStore.js';

// Enterprise AI Matching Architecture, Phase 3 - Feature Store. buildFeatureRecord is pure (no
// DB dependency) - persistMatchFeatures itself needs a real DB and is covered by the integration
// test pass instead.

const baseParams = {
  companyId: 1,
  jobId: 10,
  candidateId: 100,
  weighting: 'static' as const,
  tier: 'full' as const,
  modelVersion: 'random_forest',
  source: 'job_detail',
};

describe('buildFeatureRecord', () => {
  it('unpacks an 8-element feature vector into the exact named columns, in FEATURE_NAMES order', () => {
    const record = buildFeatureRecord({ ...baseParams, featureVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] });
    expect(record).toEqual({
      company_id: 1,
      job_id: 10,
      candidate_id: 100,
      feature_schema_version: FEATURE_SCHEMA_VERSION,
      jaccard_skill_score: 0.1,
      cosine_text_score: 0.2,
      cosine_bert_score: 0.3,
      euclidean_feature_score: 0.4,
      experience_score: 0.5,
      location_score: 0.6,
      salary_score: 0.7,
      levenshtein_title_score: 0.8,
      weighting: 'static',
      tier: 'full',
      model_version: 'random_forest',
      source: 'job_detail',
    });
  });

  it('returns null rather than guessing when the feature vector has the wrong length', () => {
    expect(buildFeatureRecord({ ...baseParams, featureVector: [1, 2, 3] })).toBeNull();
  });

  it('returns null when featureVector is not an array', () => {
    expect(buildFeatureRecord({ ...baseParams, featureVector: undefined as any })).toBeNull();
  });

  it('always stamps the current FEATURE_SCHEMA_VERSION, not a caller-supplied one', () => {
    const record = buildFeatureRecord({ ...baseParams, featureVector: [1, 1, 1, 1, 1, 1, 1, 1] });
    expect(record?.feature_schema_version).toBe(FEATURE_SCHEMA_VERSION);
  });
});
