/**
 * HTTP client for the monolith's /internal/recruiting/* API (src/api/recruiting-internal.routes.ts,
 * Batch 19) - GET /api/matches needs mutual_matches joined with jobs and candidates, all three
 * still belonging to the monolith's Recruiting/Matching domain (real foreign keys this service
 * does not own - see config/env.ts's header comment). This module's only job is the network call
 * and basic latency/outcome metrics, never re-deriving or reshaping what the monolith already
 * computed (getRecruiterMatches() is unchanged, called from the internal route as a thin wrapper).
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
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/recruiting${path}`, {
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
      // Raw network/timeout failures must also surface as MonolithProxyError - a fetch() rejection
      // (connection refused, DNS failure, AbortSignal.timeout) is NOT a MonolithProxyError by
      // default, which would otherwise let a genuine upstream-unreachable condition fall through
      // to a route's generic catch block as a 500 instead of the correct 502. See candidate-service's
      // monolithClient.ts / Batch 17's chat-service fix for the exact bug this avoids.
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

export interface RecruiterMatch {
  id: number;
  job_id: number;
  matched_at: string;
  job_title: string;
  candidate_id: number | null;
  candidate_name: string | null;
  candidate_email: string | null;
  candidate_skills: unknown;
  candidate_years_of_experience: unknown;
  notification_id: number | null;
  read_at: string | null;
}

export function getRecruiterMatches(companyId: number, jobId?: number, userId?: number): Promise<{ matches: RecruiterMatch[] }> {
  const params = new URLSearchParams({ companyId: String(companyId) });
  if (jobId !== undefined) params.set('jobId', String(jobId));
  if (userId !== undefined) params.set('userId', String(userId));
  return call('matches', `/matches?${params.toString()}`);
}
