/**
 * Assembles the classification-ensemble training set from the services that own each dataset,
 * replacing monolithClient.trainModel() - the last business-critical monolith dependency.
 *
 *   swipes             -> matching-decision-service GET /internal/swipes/all
 *   candidates         -> candidate-core-service    GET /internal/candidates/all
 *   jobs               -> job-service               GET /internal/jobs/all
 *   application status -> candidate-service         GET /internal/application-status/all
 *
 * All unscoped: training pools across every company, exactly as the monolith's own
 * getAllSwipesUnscoped/getAllCandidatesUnscoped/getAllJobsUnscoped/
 * getAllApplicationStatusLinkedToCandidatesUnscoped did. None are Gateway-reachable - proxy.ts
 * 404s /internal/* unconditionally, so these stay network-boundary-trusted service-to-service
 * reads.
 *
 * No join is needed for application status. The monolith JOINed candidate_application_status to
 * `candidates` because its copy of that table was keyed by candidate_account_id;
 * candidate-service's table is keyed by candidate_id - the same candidate-core id that swipes
 * use - so the rows key directly onto the training samples. Verified against the live schema
 * rather than assumed from the monolith's query.
 *
 * Never throws: an upstream failure yields an empty set and the caller reports "no samples"
 * rather than failing the request, matching the monolith's own try/catch-and-log behaviour.
 */
import {
  MATCHING_DECISION_SERVICE_URL,
  CANDIDATE_CORE_SERVICE_URL,
  JOB_SERVICE_URL,
  CANDIDATE_SERVICE_URL,
} from '../config/env.js';
import { logger } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 30000;

async function fetchList<T>(url: string, key: string, label: string): Promise<T[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ status: res.status, label }, 'Training data upstream returned non-ok status');
      return [];
    }
    const body: any = await res.json().catch(() => ({}));
    return (body?.[key] ?? []) as T[];
  } catch (error) {
    logger.warn({ err: (error as Error).message, label }, 'Failed to fetch training data from upstream');
    return [];
  }
}

export interface TrainingData {
  swipes: any[];
  candidates: any[];
  jobs: any[];
  /** Key: `${candidate_id}:${job_id}` -> status. Same shape the monolith's map had. */
  applicationStatusByCandidateJob: Map<string, string>;
}

export async function getTrainingData(): Promise<TrainingData> {
  const [swipes, candidates, jobs, statusRows] = await Promise.all([
    fetchList<any>(`${MATCHING_DECISION_SERVICE_URL}/internal/swipes/all`, 'swipes', 'swipes'),
    fetchList<any>(`${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/all`, 'candidates', 'candidates'),
    fetchList<any>(`${JOB_SERVICE_URL}/internal/jobs/all`, 'jobs', 'jobs'),
    fetchList<any>(`${CANDIDATE_SERVICE_URL}/internal/application-status/all`, 'rows', 'application-status'),
  ]);

  const applicationStatusByCandidateJob = new Map<string, string>();
  for (const row of statusRows) {
    if (row?.candidate_id != null && row?.job_id != null && row?.status) {
      applicationStatusByCandidateJob.set(`${row.candidate_id}:${row.job_id}`, row.status);
    }
  }

  logger.info(
    {
      swipes: swipes.length,
      candidates: candidates.length,
      jobs: jobs.length,
      statusRows: statusRows.length,
      statusUsable: applicationStatusByCandidateJob.size,
    },
    'Assembled ML training data from owning services'
  );

  return { swipes, candidates, jobs, applicationStatusByCandidateJob };
}
