/**
 * HTTP client for the monolith's /internal/matching-scoring/* API
 * (src/api/matching-scoring-internal.routes.ts) - minimal client for batch training only.
 *
 * Phase D Item 5 COMPLETE: ML admin state (activeModelType, isRetrainingInProgress,
 * lastTrainingTimestamp) is now owned locally by matching-scoring-service (src/matching/services.ts).
 * mlAdmin.routes.ts reads/writes local state, not monolith.
 *
 * ONLY trainModel() proxies to monolith (batch job needing cross-service data reads).
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

export interface TrainResult {
  success: boolean;
  activeModelType: string;
  isRetrainingInProgress: boolean;
  lastTrainingTimestamp: string;
  ensembleTrained: boolean;
  trainedSampleCount: number;
}

// Phase D Item 5: getModelConfig/setModelConfig removed (local state owned by matching-scoring-service)
// Only trainModel remains (batch job with cross-service dependencies)

export function trainModel(): Promise<TrainResult> {
  return call('train', '/train', { method: 'POST' }, TRAIN_REQUEST_TIMEOUT_MS);
}
