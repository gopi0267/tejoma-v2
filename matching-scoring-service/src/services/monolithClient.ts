/**
 * HTTP client for the monolith's /internal/matching-scoring/* API
 * (src/api/matching-scoring-internal.routes.ts) - the ML admin surface (/ml/config, /ml/train,
 * /ml/model/status, /ml/model/versions) delegates its actual state to the monolith's
 * activeModelType/trainModelOnStartup (see config/env.ts's header comment for why). Same shape as
 * recruiting-service's own monolithClient.ts - the network call and basic latency/outcome metrics
 * only, never re-deriving what the monolith already computed.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 8000;
// Real ensemble retraining (DB reads + feature-vector building + a call to
// python-services/matching-ml-service) can run considerably longer than a normal request -
// generous but bounded, same reasoning as bgeShadowServiceClient.ts's own long-running-call timeout.
const TRAIN_REQUEST_TIMEOUT_MS = 60000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/matching-scoring${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    monolithProxyCount.inc({ target, outcome: 'success' });
    return body as T;
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

export interface ModelConfig {
  activeModelType: string;
  isRetrainingInProgress: boolean;
  lastTrainingTimestamp: string;
}

export interface TrainResult extends ModelConfig {
  success: boolean;
  ensembleTrained: boolean;
  trainedSampleCount: number;
}

export interface ModelStatus {
  ensemble_trained: boolean;
  trained_sample_count: number;
  total_swipes_available: number;
  last_trained: string;
  ml_service_reachable: boolean;
}

export function getModelConfig(): Promise<ModelConfig> {
  return call('model-config', '/model-config');
}

export function setModelConfig(activeModelType: string): Promise<ModelConfig> {
  return call('model-config', '/model-config', { method: 'POST', body: JSON.stringify({ activeModelType }) });
}

export function trainModel(): Promise<TrainResult> {
  return call('train', '/train', { method: 'POST' }, TRAIN_REQUEST_TIMEOUT_MS);
}

export function getModelStatus(): Promise<ModelStatus> {
  return call('model-status', '/model-status');
}

export function getModelVersions(): Promise<unknown[]> {
  return call('model-versions', '/model-versions');
}
