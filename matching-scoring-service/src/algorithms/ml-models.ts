/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Node-side client for the RandomForest + XGBoost + LightGBM ensemble running in
 * python-services/matching-ml-service. Replaces the previous hand-rolled TypeScript
 * RandomForestClassifier (src/ml.ts) with real, tested scikit-learn/XGBoost/LightGBM models.
 *
 * The 8-feature vector schema here MUST stay in sync with FEATURE_NAMES in
 * python-services/matching-ml-service/ensemble.py - see buildFeatureVector() in src/matching/services.ts
 * for where the vector is actually assembled from match metrics.
 */
import { logger } from '../utils/logger.js';

const ML_SERVICE_URL = process.env.MATCHING_ML_SERVICE_URL || 'http://localhost:8009';
const REQUEST_TIMEOUT_MS = 8000;
// Batch training budget - see trainEnsemble below.
const TRAIN_TIMEOUT_MS = 300000;

export interface TrainSample {
  features: number[];
  label: 0 | 1;
  // Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine (see
  // src/matching/feedbackSignals.ts). Optional, 0-1 confidence in this sample's label - omitted
  // (or 1) reproduces pre-Phase-3 behavior exactly (every sample trusted equally). Passed to the
  // Python ensemble's sample_weight on every underlying classifier's .fit() call.
  weight?: number;
}

export interface TrainResult {
  trained: boolean;
  sampleCount: number;
  reason?: string;
  cvAccuracy?: { randomForest: number; xgboost: number; lightgbm: number } | null;
  note?: string;
}

export interface EnsemblePrediction {
  randomForest: number;
  xgboost: number;
  lightgbm: number;
  ensemble: number;
}

async function postJson<T>(path: string, body: any, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ML_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      logger.warn({ path, status: res.status }, 'Matching ML service returned a non-OK status');
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ path, err: err.message }, 'Matching ML service unavailable');
    return null;
  }
}

export async function trainEnsemble(samples: TrainSample[]): Promise<TrainResult | null> {
  // Training is an admin-triggered BATCH job, not the scoring hot path, so it gets its own
  // generous budget rather than a multiple of the per-request timeout. At REQUEST_TIMEOUT_MS * 4
  // (32s) a real training run of 116 samples across RandomForest + XGBoost + LightGBM with
  // cross-validation exceeded the client timeout and returned null, which the caller reported as
  // 'ML service unavailable' - while the Python service had in fact trained successfully
  // (its /health showed ensembleTrained=true, trainedSampleCount=116, matching the request).
  // A successful train reported as a failure is worse than a slow one: an operator retrains in a
  // loop, each run costing real compute.
  return postJson<TrainResult>('/train', { samples }, TRAIN_TIMEOUT_MS);
}

/**
 * Scores N feature vectors in a SINGLE HTTP round-trip, not N separate calls - this matters
 * because match scoring happens for whole candidate pools at once (e.g. GET /jobs/:id scores
 * every candidate against a job), not one at a time.
 */
export async function predictBatch(featureVectors: number[][]): Promise<EnsemblePrediction[] | null> {
  if (featureVectors.length === 0) return [];
  const result = await postJson<{ trained: boolean; predictions: EnsemblePrediction[] }>('/predict/batch', { featureVectors });
  if (!result || !result.trained) return null;
  return result.predictions;
}

export async function getEnsembleHealth(): Promise<{ ensembleTrained: boolean; trainedSampleCount: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ML_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return (await res.json()) as { ensembleTrained: boolean; trainedSampleCount: number };
  } catch {
    return null;
  }
}
