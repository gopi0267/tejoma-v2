/**
 * Ported verbatim from the monolith's src/algorithms/ltr-models.ts - Node-side client for the
 * Learning-to-Rank ensemble (XGBRanker + LGBMRanker) running in
 * python-services/matching-ml-service/ranker.py. Called directly by this service, never through
 * the monolith - same as the monolith's own copy always did (see config/env.ts's header comment).
 */
import { logger } from '../utils/logger.js';

const ML_SERVICE_URL = process.env.MATCHING_ML_SERVICE_URL || 'http://localhost:8009';
const REQUEST_TIMEOUT_MS = 8000;

export interface RankingSample {
  features: number[];
  relevance: number;
}

export interface RankingGroup {
  jobId: number;
  samples: RankingSample[];
}

export interface RankingTrainResult {
  trained: boolean;
  exampleCount: number;
  groupCount: number;
  reason?: string;
}

export interface RankingPrediction {
  xgboostRanker: number;
  lightgbmRanker: number;
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
      logger.warn({ path, status: res.status }, 'Learning-to-Rank service returned a non-OK status');
      return null;
    }
    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.debug({ path, err: err.message }, 'Learning-to-Rank service unavailable');
    return null;
  }
}

export async function trainRanking(groups: RankingGroup[]): Promise<RankingTrainResult | null> {
  return postJson<RankingTrainResult>('/train/ranking', { groups }, REQUEST_TIMEOUT_MS * 4);
}

export async function predictRankingBatch(featureVectors: number[][]): Promise<RankingPrediction[] | null> {
  if (featureVectors.length === 0) return [];
  const result = await postJson<{ trained: boolean; predictions: RankingPrediction[] }>('/predict/ranking/batch', { featureVectors });
  if (!result || !result.trained) return null;
  return result.predictions;
}

export async function getRankerHealth(): Promise<{ rankerTrained: boolean; rankerTrainedExampleCount: number; rankerTrainedGroupCount: number } | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${ML_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return (await res.json()) as { rankerTrained: boolean; rankerTrainedExampleCount: number; rankerTrainedGroupCount: number };
  } catch {
    return null;
  }
}
