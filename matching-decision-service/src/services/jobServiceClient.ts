/**
 * HTTP client for job-service's /internal/jobs/* (Remaining-monolith migration, Step 6) - job data
 * for the real-cutover routes (queue, score, swipe history). job-service is the authoritative
 * mirror for `jobs` (dual-written since Step 4); this service has no copy of its own.
 */
import { JOB_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';
import type { Job } from '../types.js';

const REQUEST_TIMEOUT_MS = 5000;

async function call<T>(target: string, path: string): Promise<T | null> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${JOB_SERVICE_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
      return null;
    }
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'success' });
    return (await res.json()) as T;
  } catch (error) {
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
    logger.error({ err: (error as Error).message, target }, 'job-service internal API call failed');
    return null;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'job-service', target }, durationSeconds);
  }
}

export async function getJobById(id: number, companyId: number): Promise<Job | null> {
  const body = await call<{ job: Job }>('job-by-id', `/internal/jobs/${id}?companyId=${companyId}`);
  return body?.job ?? null;
}

export async function getJobsByIds(ids: number[], companyId: number): Promise<Job[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ companyId: String(companyId), ids: ids.join(',') });
  const body = await call<{ jobs: Job[] }>('jobs-by-ids', `/internal/jobs/by-ids?${params.toString()}`);
  return body?.jobs ?? [];
}
