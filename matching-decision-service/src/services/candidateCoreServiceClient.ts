/**
 * HTTP client for candidate-core-service's /internal/candidates/* (Remaining-monolith migration,
 * Step 6) - candidate data for the real-cutover routes (queue, score, swipe history).
 * candidate-core-service is the authoritative mirror for `candidates` (dual-written since Step
 * 3a); this service has no copy of its own.
 */
import { CANDIDATE_CORE_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';
import type { Candidate } from '../types.js';

const REQUEST_TIMEOUT_MS = 5000;

async function call<T>(target: string, path: string): Promise<T | null> {
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(`${CANDIDATE_CORE_SERVICE_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'candidate-core-service', target, outcome: 'error' });
      return null;
    }
    upstreamProxyCount.inc({ upstream: 'candidate-core-service', target, outcome: 'success' });
    return (await res.json()) as T;
  } catch (error) {
    upstreamProxyCount.inc({ upstream: 'candidate-core-service', target, outcome: 'error' });
    logger.error({ err: (error as Error).message, target }, 'candidate-core-service internal API call failed');
    return null;
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'candidate-core-service', target }, durationSeconds);
  }
}

export async function getCandidatesByIds(ids: number[], companyId: number): Promise<Candidate[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ companyId: String(companyId), ids: ids.join(',') });
  const body = await call<{ candidates: Candidate[] }>('candidates-by-ids', `/internal/candidates/by-ids?${params.toString()}`);
  return body?.candidates ?? [];
}

// Deliberately NOT calling the plain GET /internal/candidates/:id - that endpoint's documented
// contract returns the RAW row (delimited-string skills etc.), not mapRowToCandidate-parsed, and
// this service's scoring calls need real arrays (computeMatchFeatures checks
// Array.isArray(candidate.skills) - the exact class of bug Step 4 found and fixed for job-service).
// by-ids already applies mapRowToCandidate, so single-candidate lookups reuse it with a one-item
// array instead of relying on a second, differently-shaped endpoint.
export async function getCandidateById(id: number, companyId: number): Promise<Candidate | null> {
  const candidates = await getCandidatesByIds([id], companyId);
  return candidates[0] ?? null;
}
