/**
 * HTTP client for the monolith's /internal/analytics/* API (src/api/analytics-internal.routes.ts,
 * Batch 22) - this service owns nothing directly, so every route is a proxy call here. This
 * module's only job is the network call and basic latency/outcome metrics, never re-deriving or
 * reshaping what the monolith already computed.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 8000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/analytics${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      // Raw network/timeout failures must also surface as MonolithProxyError - see
      // recruiting-service's monolithClient.ts (Batch 19) for the exact bug this avoids.
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

export function getDashboard(companyId: number): Promise<any> {
  return call('dashboard', `/dashboard?companyId=${companyId}`);
}

export function getJobAnalytics(jobId: number, companyId: number): Promise<any> {
  return call('job', `/job/${jobId}?companyId=${companyId}`);
}

export function getRecruiterProfile(userId: number, companyId: number): Promise<any> {
  return call('recruiter-profile', `/recruiter-profile?userId=${userId}&companyId=${companyId}`);
}

export function getSkills(companyId: number): Promise<{ skillDistribution: { name: string; value: number }[] }> {
  return call('skills', `/skills?companyId=${companyId}`);
}
