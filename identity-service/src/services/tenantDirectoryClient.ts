/**
 * Client for Tenant Directory Service's company-lookup API - the cross-service replacement for
 * the monolith's direct `db.getCompanyById()` call.
 *
 * IMPLEMENTATION ISSUE, resolved per the required methodology:
 *   Problem: the monolith's login/refresh/me handlers enrich the session response with full
 *     company detail (name, logo, plan) via a direct query against the companies table, since
 *     users and companies share one database today.
 *   Why it exists: that was the natural, cheapest approach when both tables lived in the same
 *     database - no cross-service call was ever needed.
 *   Impact: once Identity DB is physically separate from Tenant Directory's database (the entire
 *     point of this split, Phase 3(database) section 1), Identity Service cannot query companies
 *     directly - Phase 3(database) section 4's "no cross-service DB access" rule applies exactly
 *     here.
 *   Minimum change: Identity Service calls Tenant Directory's API instead - the "opaque ID
 *     reference, resolved via API call" pattern Phase 3(database) section 4 already specifies as
 *     the target design, not a new decision.
 *
 * Tenant Directory Service now exists (Batch 11) - set TENANT_DIRECTORY_SERVICE_URL to point
 * here at it for real. The graceful-null contract (return null on unavailable, never throw) is
 * unchanged and still matters going forward - the same "return null on unavailable, never throw"
 * pattern used everywhere in the original monolith for soft external dependencies (see
 * bert-embeddings.ts's generateEmbedding) - Tenant Directory Service being briefly unreachable
 * (a deploy in progress, a network blip) must never fail a login/refresh/me request outright,
 * since company_id itself (not this enrichment) is what actually gates access.
 */
import { logger } from '../utils/logger.js';

const TENANT_DIRECTORY_SERVICE_URL = process.env.TENANT_DIRECTORY_SERVICE_URL || null;
const REQUEST_TIMEOUT_MS = 2000;

export interface CompanyInfo {
  id: number;
  name: string;
  logo_url: string | null;
  plan: string;
}

export async function getCompanyById(companyId: number): Promise<CompanyInfo | null> {
  if (!TENANT_DIRECTORY_SERVICE_URL) {
    // Not configured (the expected state until Tenant Directory Service exists, see header note)
    // - not an error, just an unavailable enrichment.
    return null;
  }

  try {
    const response = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies/${companyId}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as CompanyInfo;
  } catch (error: any) {
    logger.warn({ err: error?.message, companyId }, 'Tenant Directory company lookup failed - returning null enrichment');
    return null;
  }
}
