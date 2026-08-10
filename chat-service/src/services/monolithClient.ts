/**
 * HTTP client for the monolith's /internal/chat/* API (src/api/chat-internal.routes.ts,
 * Batch 17) - candidate/job counts and unscoped candidate/job lists still belong to the
 * monolith's Recruiting/Matching domain. See config/env.ts's header comment for why this is
 * required, not graceful-null.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount } from '../utils/metrics.js';
import type { CandidateForChunk, JobForChunk } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000; // unscoped candidate/job lists can be large - more generous than jd-parser/candidate-service's proxy timeouts

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string): Promise<T> {
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/chat${path}`, {
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
    if (error instanceof MonolithProxyError) throw error;
    // A genuine network/timeout failure (connection refused, DNS, abort) - `fetch` itself threw
    // before ever producing a status code, so this is NOT the same as an HTTP error response
    // above. Wrapped as a MonolithProxyError too (status 502, no real HTTP status to report) so
    // every caller can reliably tell "the monolith call failed" apart from an unrelated failure
    // (a local DB error, a Gemini error) with one `instanceof` check, regardless of which of the
    // two failure modes actually happened - see src/routes/chat.routes.ts's catch block, which
    // mixes monolith calls with local DB and Gemini calls and must not conflate them.
    monolithProxyCount.inc({ target, outcome: 'error' });
    logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
    throw new MonolithProxyError(502, { error: (error as Error).message });
  }
}

// Item 6 (Chat RAG corpus reads): Use service endpoints instead of monolith
export async function getPlatformStats(companyId: number): Promise<{ candidateCount: number; jobCount: number }> {
  const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';
  const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || 'http://localhost:4018';

  try {
    const [candidateResult, jobResult] = await Promise.all([
      fetch(`${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/count?companyId=${companyId}`).then((r) => r.json()),
      fetch(`${JOB_SERVICE_URL}/internal/jobs?companyId=${companyId}`).then((r) => r.json()),
    ]);

    return {
      candidateCount: candidateResult.count || 0,
      jobCount: jobResult.jobs?.length || 0,
    };
  } catch (error) {
    monolithProxyCount.inc({ target: 'platform-stats-services', outcome: 'error' });
    logger.error({ err: (error as Error).message }, 'Failed to get platform stats from services');
    throw new MonolithProxyError(502, { error: (error as Error).message });
  }
}

export async function getAllCandidatesUnscoped(): Promise<{ candidates: CandidateForChunk[] }> {
  const CANDIDATE_CORE_SERVICE_URL = process.env.CANDIDATE_CORE_SERVICE_URL || 'http://localhost:4019';

  try {
    const result = await fetch(`${CANDIDATE_CORE_SERVICE_URL}/internal/candidates/all`).then((r) => r.json());
    return { candidates: result.candidates || [] };
  } catch (error) {
    monolithProxyCount.inc({ target: 'candidates-unscoped-service', outcome: 'error' });
    logger.error({ err: (error as Error).message }, 'Failed to get all candidates from service');
    throw new MonolithProxyError(502, { error: (error as Error).message });
  }
}

export async function getAllJobsUnscoped(): Promise<{ jobs: JobForChunk[] }> {
  const JOB_SERVICE_URL = process.env.JOB_SERVICE_URL || 'http://localhost:4018';

  try {
    const result = await fetch(`${JOB_SERVICE_URL}/internal/jobs/all`).then((r) => r.json());
    return { jobs: result.jobs || [] };
  } catch (error) {
    monolithProxyCount.inc({ target: 'jobs-unscoped-service', outcome: 'error' });
    logger.error({ err: (error as Error).message }, 'Failed to get all jobs from service');
    throw new MonolithProxyError(502, { error: (error as Error).message });
  }
}
