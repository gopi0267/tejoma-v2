/**
 * HTTP client for identity-service's /internal/candidates/last-active (Remaining-monolith
 * migration, Step 5) - candidate auth sessions are identity-service's own domain (config/env.ts's
 * header comment), not this service's, so candidate-search.routes.ts's "last_active" enrichment
 * goes through a real cross-service call, not a local query.
 */
import { IDENTITY_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 5000;

export async function getCandidateAccountsLastActiveBulk(candidateAccountIds: number[]): Promise<Map<number, string>> {
  if (candidateAccountIds.length === 0) return new Map();
  const start = process.hrtime.bigint();
  try {
    const params = new URLSearchParams({ ids: candidateAccountIds.join(',') });
    const res = await fetch(`${IDENTITY_SERVICE_URL}/internal/candidates/last-active?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      upstreamProxyCount.inc({ upstream: 'identity-service', target: 'last-active', outcome: 'error' });
      return new Map();
    }
    upstreamProxyCount.inc({ upstream: 'identity-service', target: 'last-active', outcome: 'success' });
    const lastActive: Record<string, string> = body.lastActive || {};
    return new Map(Object.entries(lastActive).map(([id, ts]) => [Number(id), ts]));
  } catch (error) {
    upstreamProxyCount.inc({ upstream: 'identity-service', target: 'last-active', outcome: 'error' });
    logger.error({ err: (error as Error).message }, 'identity-service last-active call failed');
    return new Map();
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    upstreamProxyDuration.observe({ upstream: 'identity-service', target: 'last-active' }, durationSeconds);
  }
}
