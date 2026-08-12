/**
 * HTTP client for job-service's existing /internal/jobs/by-ids endpoint.
 *
 * Replaces monolithClient.getJobTitles, which proxied to the monolith on the premise that "jobs
 * remain monolith-owned" (shadowDataHealth.ts's header comment, Batch 25). That is no longer
 * true - job-service owns the jobs table outright and already exposes exactly this lookup,
 * company-scoped, at GET /internal/jobs/by-ids?companyId=&ids=. Pointing at the owning service
 * removes the last monolith dependency on GET /api/shadow-data-health without adding any new
 * endpoint or duplicating job data here.
 *
 * Same fire-and-forget, bounded-timeout, never-throws convention as every other service client in
 * this repo: an upstream failure degrades seniority inference to "unknown" rather than failing
 * the whole health report.
 */
import { JOB_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 10000;

/** Job titles for a bounded set of ids, company-scoped. Shape matches the old getJobTitles return. */
export async function getJobTitles(
  companyId: number,
  jobIds: number[]
): Promise<{ jobs: { id: number; title: string }[] }> {
  if (jobIds.length === 0) return { jobs: [] };

  try {
    const params = new URLSearchParams({ companyId: String(companyId), ids: jobIds.join(',') });
    const res = await fetch(`${JOB_SERVICE_URL}/internal/jobs/by-ids?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'job-service returned non-ok status for jobs by ids');
      return { jobs: [] };
    }
    const body: any = await res.json().catch(() => ({}));
    const jobs = ((body.jobs ?? []) as Array<{ id: number; title: string }>).map((j) => ({
      id: j.id,
      title: j.title,
    }));
    return { jobs };
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Failed to fetch job titles from job-service');
    return { jobs: [] };
  }
}
