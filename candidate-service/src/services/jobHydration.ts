/**
 * Hydrates job/company display fields onto rows this service's own tables can only reference by
 * id. candidate_decisions and mutual_matches carry job_id/company_id, but this database owns no
 * `jobs` or `companies` table - job-service owns jobs, tenant-directory-service owns companies -
 * so the display fields have to come across the service boundary rather than from a SQL JOIN.
 *
 * jobServiceClient.getJobsByIds is company-scoped (a single companyId per call, matching
 * job-service's own tenant check), while a candidate's decision history can span several
 * companies. Rows are therefore grouped by company_id and fetched one call per company, then
 * merged into a single jobId -> job map. Company names for the same set of company_ids are
 * fetched once via tenantDirectoryServiceClient and merged onto each job.
 *
 * Failure is non-fatal by design: both clients already log and return empty results on an
 * upstream error, so an outage degrades these responses to id-only rows instead of failing the
 * whole request. That matches how candidateAnalytics already treats the same class of dependency.
 */
import { getJobsByIds, type Job } from './jobServiceClient.js';
import { getCompaniesByIds } from './tenantDirectoryServiceClient.js';

export interface HydratedJob extends Job {
  company_name?: string;
  company_logo_url?: string | null;
}

export async function hydrateJobsForRows(
  rows: Array<{ job_id?: number | null; company_id?: number | null }>
): Promise<Map<number, HydratedJob>> {
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

  const jobsById = new Map<number, HydratedJob>();
  await Promise.all(
    [...byCompany.entries()].map(async ([companyId, ids]) => {
      const jobs = await getJobsByIds([...ids], companyId);
      for (const job of jobs) jobsById.set(job.id, job);
    })
  );

  const companies = await getCompaniesByIds([...byCompany.keys()]);
  for (const job of jobsById.values()) {
    const company = companies.get(job.company_id);
    if (company) {
      job.company_name = company.name;
      job.company_logo_url = company.logo_url;
    }
  }

  return jobsById;
}
