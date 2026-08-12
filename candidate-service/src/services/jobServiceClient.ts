/**
 * HTTP client for job-service's /internal/jobs/* endpoints.
 * /internal/jobs/by-ids - Item 4 analytics computation, fetches job metadata to populate
 * analytics views and compute recommendations.
 * /internal/jobs/all - the one job-service endpoint with no companyId scope, added by job-service
 * itself "for whichever future caller (e.g. candidate-facing job browsing, which only ever reads)
 * needs it" (job-service/src/routes/internal.routes.ts's own header comment). Candidate job
 * browsing is cross-company by nature - every other job-service endpoint (`/api/jobs`,
 * `/internal/jobs`, `/internal/jobs/:id`) requires a companyId because it serves the recruiter
 * side (their own company's postings only) - so this is the correct, already-existing endpoint to
 * reuse rather than adding a new one.
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

export async function getAllOpenJobs(): Promise<Job[]> {
  const target = 'jobs-all';
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${JOB_SERVICE_URL}/internal/jobs/all`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
      logger.warn({ status: res.status }, 'job-service returned non-ok status for jobs/all');
      return [];
    }
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'success' });
    const jobs = (body.jobs ?? []) as Job[];
    // /internal/jobs/all is a raw dump (no status filter, unlike getJobs' recruiter-side "open
    // only" behavior) - filtered here so candidate browsing only ever sees open postings.
    return jobs.filter((j) => j.status === 'open');
  } catch (error) {
    upstreamProxyCount.inc({ upstream: 'job-service', target, outcome: 'error' });
    logger.warn({ err: (error as Error).message, target }, 'Failed to fetch all jobs from job-service');
    return [];
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'job-service', target }, durationSeconds);
  }
}
