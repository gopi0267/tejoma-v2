/**
 * HTTP client for the monolith's /internal/candidate-core/* API
 * (src/api/candidate-core-internal.routes.ts) - bulk-upload/import still proxy (unchanged); create/
 * delete now call the monolith AFTER this service's own real write (write-cutover completion plan,
 * Phase A) - mirrorAndNotifyCandidateCreate/mirrorDeleteCandidate upsert the row into the
 * monolith's own `candidates` table (by explicit id, its own sequence no longer assigns new ids
 * for rows this service creates) and re-fire the same background side effects
 * createCandidateWithSideEffects/deleteCandidate always fired - see routes/candidates.routes.ts's
 * header comment for the full await-but-non-fatal contract.
 */
import { MONOLITH_INTERNAL_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { monolithProxyCount, monolithProxyDuration } from '../utils/metrics.js';
import type { Candidate } from '../types.js';
import type { CandidateRow } from '../types.js';

const REQUEST_TIMEOUT_MS = 15000;
// Bulk-upload/import can process many candidates sequentially (each with 6 background side
// effects fired) - generous but bounded, same reasoning as every other long-running proxy call in
// this migration.
const BULK_REQUEST_TIMEOUT_MS = 60000;

export class MonolithProxyError extends Error {
  constructor(public readonly status: number, public readonly body: any) {
    super(`Monolith internal API returned ${status}`);
  }
}

async function call<T>(target: string, path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${MONOLITH_INTERNAL_URL}/internal/candidate-core${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
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
      throw new MonolithProxyError(502, { error: (error as Error).message });
    }
    throw error;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    monolithProxyDuration.observe({ target }, durationSeconds);
  }
}

// Awaited by the route handler, but never allowed to turn into a user-facing failure - the
// service's own write already succeeded by the time this is called. Mirrors dualWrite.ts's own
// safety bar in the opposite direction.
export async function mirrorAndNotifyCandidateCreate(row: CandidateRow): Promise<void> {
  try {
    await call('mirror-create', '/candidates/mirror-and-notify', { method: 'POST', body: JSON.stringify({ candidate: row }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, candidateId: row.id }, 'Failed to mirror new candidate into the monolith - its own copy will be stale until the next write to this row');
  }
}

export async function mirrorDeleteCandidate(id: number, companyId: number): Promise<void> {
  try {
    await call('mirror-delete', '/candidates/mirror-delete', { method: 'POST', body: JSON.stringify({ id, companyId }) });
  } catch (error) {
    logger.warn({ err: (error as Error).message, candidateId: id }, 'Failed to mirror candidate deletion into the monolith - its own copy will be stale until manually reconciled');
  }
}

export function bulkUploadCandidates(candidates: Partial<Candidate>[], companyId: number): Promise<{ success: boolean; inserted: number; errors: Array<{ candidate: string; error: string }> }> {
  return call('bulk-upload', '/bulk-upload-candidates', { method: 'POST', body: JSON.stringify({ candidates, companyId }) }, BULK_REQUEST_TIMEOUT_MS);
}

export function importCandidates(candidates: Partial<Candidate>[], companyId: number): Promise<{ success: boolean; message: string; imported_count: number; error_count: number; candidates: (Candidate | null)[]; errors: string[] }> {
  return call('import', '/candidates/import', { method: 'POST', body: JSON.stringify({ candidates, companyId }) }, BULK_REQUEST_TIMEOUT_MS);
}
