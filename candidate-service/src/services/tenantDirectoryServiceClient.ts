/**
 * Tenant Directory Service Client
 *
 * Calls tenant-directory-service's existing internal endpoint to fetch company display fields
 * (name, logo). Companies live only in tenant-directory-service and the monolith's own database -
 * never in candidate-service's or job-service's - so job/decision/application/match rows that
 * carry a company_id need this cross-service call to render a company name at all.
 *
 * Pattern: same fire-and-forget, bounded-timeout, never-throws convention as
 * candidateCoreServiceClient.ts and jobServiceClient.ts.
 */

import { TENANT_DIRECTORY_SERVICE_URL } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { upstreamProxyCount, upstreamProxyDuration } from '../utils/metrics.js';

const REQUEST_TIMEOUT_MS = 5000;

export interface CompanySummary {
  id: number;
  name: string;
  logo_url: string | null;
}

/** Fetches company display fields for a bounded set of ids, one request per id (no batch endpoint exists on tenant-directory-service). */
export async function getCompaniesByIds(ids: number[]): Promise<Map<number, CompanySummary>> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  const result = new Map<number, CompanySummary>();
  if (uniqueIds.length === 0) return result;

  await Promise.all(
    uniqueIds.map(async (id) => {
      const target = 'company-by-id';
      const start = process.hrtime.bigint();
      try {
        const res = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies/${id}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          upstreamProxyCount.inc({ upstream: 'tenant-directory-service', target, outcome: 'error' });
          return;
        }
        const body: any = await res.json().catch(() => null);
        if (body?.id) {
          result.set(body.id, { id: body.id, name: body.name, logo_url: body.logo_url ?? null });
        }
        upstreamProxyCount.inc({ upstream: 'tenant-directory-service', target, outcome: 'success' });
      } catch (error) {
        upstreamProxyCount.inc({ upstream: 'tenant-directory-service', target, outcome: 'error' });
        logger.warn({ err: (error as Error).message, companyId: id }, 'Failed to fetch company from tenant-directory-service');
      } finally {
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
        upstreamProxyDuration.observe({ upstream: 'tenant-directory-service', target }, durationSeconds);
      }
    })
  );

  return result;
}
