/**
 * HTTP client for job-service's /internal/jobs/by-ids endpoint - for Item 4 analytics computation.
 * Fetches job metadata needed to populate analytics views and compute recommendations.
 */

import { JOB_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 10000;

export interface Job {
  id: number;
  company_id: number;
  title: string;
  description?: string;
  required_skills?: string;
  [key: string]: unknown;
}

export async function getJobsByIds(ids: number[], companyId: number): Promise<Job[]> {
  if (!ids.length) return [];

  const target = 'jobs-by-ids';
  const start = process.hrtime.bigint();
  try {
    const params = new URLSearchParams({ companyId: String(companyId) });
    if (ids.length > 0) params.set('ids', ids.join(','));

    const res = await fetch(`${JOB_SERVICE_URL}/internal/jobs/by-ids?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
      logger.warn({ status: res.status }, 'job-service returned non-ok status for jobs by ids');
      return [];
    }
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'success' });
    return (body.jobs ?? []) as Job[];
  } catch (error) {
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
    logger.warn({ err: (error as Error).message, target }, 'Failed to fetch jobs by ids from job-service');
    return [];
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'job-service', target }, durationSeconds);
  }
}
