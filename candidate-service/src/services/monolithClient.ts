/**
 * HTTP client for the monolith's /internal/candidate/* API (src/api/candidate-internal.routes.ts,
 * Batch 16) - jobs, decisions, applications, and matches still belong to the monolith's
 * Recruiting/Matching domain (real foreign keys into jobs/candidates/companies that this service
 * does not own). See config/env.ts's header comment for why this is required, not graceful-null.
 *
 * Every function here is a direct pass-through: same query params, same response shape as the
 * target endpoint - this module's only job is the network call and basic latency/outcome metrics,
 * never re-deriving or reshaping what the monolith already computed.
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
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/candidate${path}`, {
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
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

export interface OpenJobsQuery {
  search?: string;
  skill?: string;
  location?: string;
  company?: string;
  page?: number;
  pageSize?: number;
}

export function getOpenJobsForCandidate(candidateAccountId: number, query: OpenJobsQuery): Promise<{ jobs: any[]; total: number }> {
  const params = new URLSearchParams({ candidateAccountId: String(candidateAccountId) });
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return call('jobs', `/jobs?${params.toString()}`);
}

export function getOpenJobForCandidate(candidateAccountId: number, jobId: number): Promise<any> {
  return call('job-detail', `/jobs/${jobId}?candidateAccountId=${candidateAccountId}`);
}

export function getJobExplanationForCandidate(candidateAccountId: number, jobId: number): Promise<any> {
  return call('job-explanation', `/jobs/${jobId}/explanation?candidateAccountId=${candidateAccountId}`);
}

export function recordCandidateDecision(candidateAccountId: number, jobId: number, decisionType: string): Promise<{ decision: any }> {
  return call('record-decision', '/decisions', {
    method: 'POST',
    body: JSON.stringify({ candidateAccountId, job_id: jobId, decision_type: decisionType }),
  });
}

export function getCandidateDecisions(candidateAccountId: number): Promise<{ decisions: any[] }> {
  return call('decisions', `/decisions?candidateAccountId=${candidateAccountId}`);
}

export function getCandidateActiveDecisions(candidateAccountId: number, action?: number): Promise<{ decisions: any[] }> {
  const params = new URLSearchParams({ candidateAccountId: String(candidateAccountId) });
  if (action !== undefined) params.set('action', String(action));
  return call('active-decisions', `/decisions/active?${params.toString()}`);
}

export function getCandidateDecisionStatus(candidateAccountId: number, jobId: number): Promise<{ status: string }> {
  return call('decision-status', `/decisions/status?candidateAccountId=${candidateAccountId}&jobId=${jobId}`);
}

export function getCandidateApplications(candidateAccountId: number): Promise<{ applications: any[] }> {
  return call('applications', `/applications?candidateAccountId=${candidateAccountId}`);
}

export function getCandidateApplication(candidateAccountId: number, jobId: number): Promise<any> {
  return call('application-detail', `/applications/${jobId}?candidateAccountId=${candidateAccountId}`);
}

export function getCandidateMatches(candidateAccountId: number): Promise<{ matches: any[] }> {
  return call('matches', `/matches?candidateAccountId=${candidateAccountId}`);
}

// Remaining-monolith migration, Step 3c - candidate-analytics.routes.ts's aggregation reads
// several tables outside this service's own domain (jobs, recruiter reviews/swipes, application
// status) that haven't been extracted yet, so this proxies through, same shape as every other
// function in this file.
export function getCandidateAnalytics(candidateAccountId: number): Promise<Record<string, unknown>> {
  return call('analytics', `/analytics?candidateAccountId=${candidateAccountId}`);
}

// Remaining-monolith migration, Step 5 - candidate-search.routes.ts's "shortlisted" tab joins
// `swipes` (matching-decision-service's Step 6 domain, not done) and `candidates` (candidate-core-
// service's own table, a cross-service join away) - proxies through, unlike every other
// candidate-search endpoint in this file's new candidateSearch.routes.ts sibling, which is a real
// cutover. A different base path from every other function above (/internal/candidate-search, not
// /internal/candidate) since this is a staff-facing concern, not candidate self-service - so it
// bypasses the call() helper's hardcoded prefix.
export async function getShortlistedCandidateAccounts(companyId: number): Promise<{ candidates: any[] }> {
  const target = 'shortlisted-candidates';
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/candidate-search/shortlisted?companyId=${companyId}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      throw new MonolithProxyError(res.status, body);
    }
    monolithProxyCount.inc({ target, outcome: 'success' });
    return body as { candidates: any[] };
  } catch (error) {
    if (!(error instanceof MonolithProxyError)) {
      monolithProxyCount.inc({ target, outcome: 'error' });
      logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}
