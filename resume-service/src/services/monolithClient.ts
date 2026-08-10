/**
 * HTTP client for the monolith's /internal/resume/* API (src/api/resume-internal.routes.ts,
 * Batch 18) - the candidate's resume_file_path/resume_original_filename/resume_file_uploaded_at
 * still live on candidate_accounts, which is monolith-authoritative until cutover (Candidate
 * Service, Batch 16, only mirrors these via dual-write - it doesn't yet serve real traffic). See
 * config/env.ts's header comment for why this talks to the monolith, not Candidate Service.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 8000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}): Promise<T> {
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/resume${path}`, {
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
    if (error instanceof MonolithProxyError) throw error;
    // A genuine network/timeout failure, not an HTTP error response - wrapped the same way so
    // every caller can rely on `instanceof MonolithProxyError` regardless of which failure mode
    // actually happened. See chat-service/src/services/monolithClient.ts's identical fix (Batch 17).
    monolithProxyCount.inc({ target, outcome: 'error' });
    logger.error({ err: (error as Error).message, target }, 'Monolith internal API call failed');
    throw new MonolithProxyError(502, { error: (error as Error).message });
  }
}

export interface CandidateResumeFileInfo {
  resume_file_path: string | null;
  resume_original_filename: string | null;
}

export function getCandidateResumeFile(candidateId: number): Promise<CandidateResumeFileInfo> {
  return call('get-resume-file', `/candidate/${candidateId}`);
}

export function updateCandidateResumeFile(candidateId: number, fields: { resume_file_path: string; resume_original_filename: string; resume_file_uploaded_at: string }): Promise<CandidateResumeFileInfo> {
  return call('update-resume-file', `/candidate/${candidateId}`, { method: 'PATCH', body: JSON.stringify(fields) });
}
