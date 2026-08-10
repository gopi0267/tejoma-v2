/**
 * HTTP client for the monolith's /internal/job/* API (src/api/job-internal.routes.ts). GET
 * /api/jobs (list) still proxies (needs company-wide swipe-count aggregation not yet owned
 * anywhere). Create/update/delete now call the monolith AFTER this service's own real write
 * (write-cutover completion plan, Phase B) - mirrorAndNotifyJobCreate/mirrorAndNotifyJobUpdate/
 * mirrorDeleteJob upsert/delete the row in the monolith's own `jobs` table (by explicit id, its
 * own sequence no longer assigns new ids for rows this service creates) and re-fire the same
 * background side effects createJobWithSideEffects/updateJobWithSideEffects/deleteJob always
 * fired - see routes/jobs.routes.ts's header comment for the full await-but-non-fatal contract.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';
import type { Job } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/job${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'monolith', target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    upstreamProxyCount.inc({ upstream: 'monolith', target, outcome: 'success' });
    return body as T;
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      upstreamProxyCount.inc({ upstream: 'monolith', target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'monolith', target }, durationSeconds);
  }
}

export function getEnrichedJobsList(companyId: number): Promise<{ jobs: any[] }> {
  return call('list', `/jobs?companyId=${companyId}`);
}

// Awaited by the route handler, but never allowed to turn into a user-facing failure - the
// service's own write already succeeded by the time each of these is called. Mirrors
// dualWrite.ts's own safety bar in the opposite direction (same pattern as candidate-core-
// service's own mirrorAndNotifyCandidateCreate, write-cutover completion plan, Phase A).
export async function mirrorAndNotifyJobCreate(row: Job): Promise<void> {
  try {
    await call('mirror-create', '/jobs/mirror-and-notify', { method: 'POST', body: JSON.stringify({ job: row, isCreate: true }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, jobId: row.id }, 'Failed to mirror new job into the monolith - its own copy will be stale until the next write to this row');
  }
}

export async function mirrorAndNotifyJobUpdate(row: Job): Promise<void> {
  try {
    await call('mirror-update', '/jobs/mirror-and-notify', { method: 'POST', body: JSON.stringify({ job: row, isCreate: false }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, jobId: row.id }, 'Failed to mirror updated job into the monolith - its own copy will be stale until the next write to this row');
  }
}

export async function mirrorDeleteJob(id: number, companyId: number): Promise<void> {
  try {
    await call('mirror-delete', '/jobs/mirror-delete', { method: 'POST', body: JSON.stringify({ id, companyId }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, jobId: id }, 'Failed to mirror job deletion into the monolith - its own copy will be stale until manually reconciled');
  }
}
