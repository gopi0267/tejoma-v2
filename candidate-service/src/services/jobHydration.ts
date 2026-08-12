/**
 * Hydrates job/company display fields onto rows this service's own tables can only reference by
 * id. candidate_decisions and mutual_matches carry job_id/company_id, but this database owns no
 * `jobs` or `companies` table - job-service does - so the display fields have to come across the
 * service boundary rather than from a SQL JOIN.
 *
 * jobServiceClient.getJobsByIds is company-scoped (a single companyId per call, matching
 * job-service's own tenant check), while a candidate's decision history can span several
 * companies. Rows are therefore grouped by company_id and fetched one call per company, then
 * merged into a single jobId -> job map.
 *
 * Failure is non-fatal by design: getJobsByIds already logs and returns [] on an upstream error,
 * so a job-service outage degrades these responses to id-only rows instead of failing the whole
 * request. That matches how candidateAnalytics already treats the same dependency.
 */
import { getJobsByIds, type Job } from './jobServiceClient.js';

export async function hydrateJobsForRows(
  rows: Array<{ job_id?: number | null; company_id?: number | null }>
): Promise<Map<number, Job>> {
  const byCompany = new Map<number, Set<number>>();

  for (const row of rows) {
    if (!row.job_id || !row.company_id) continue;
    let ids = byCompany.get(row.company_id);
    if (!ids) {
      ids = new Set<number>();
      byCompany.set(row.company_id, ids);
    }
    ids.add(row.job_id);
  }

  const jobsById = new Map<number, Job>();
  await Promise.all(
    [...byCompany.entries()].map(async ([companyId, ids]) => {
      const jobs = await getJobsByIds([...ids], companyId);
      for (const job of jobs) jobsById.set(job.id, job);
    })
  );

  return jobsById;
}
