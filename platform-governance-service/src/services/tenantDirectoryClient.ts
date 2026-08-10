/**
 * Client for Tenant Directory Service's company-name-exists check - the cross-service replacement
 * for the monolith's direct `db.getCompanyByName(name)` call inside company-registration
 * submission (src/api/company-requests.routes.ts:68 in the monolith).
 *
 * IMPLEMENTATION ISSUE, resolved per the required methodology:
 *   Problem: registration submission pre-checks whether a company with this name already exists,
 *     so a prospective customer gets an immediate, friendly error instead of a confusing failure
 *     later.
 *   Why it exists: `companies` is owned by Tenant Directory Service (Phase 3(database) section 1),
 *     which does not exist yet (Batch 11) - this service's own database has no companies table to
 *     query, by design (Phase 3(database) section 4's per-service isolation).
 *   Impact: today, this pre-check can never return a definite answer. Skipping it is safe, not
 *     silently wrong: the real, authoritative uniqueness enforcement happens at approval time
 *     (companies.name has a UNIQUE constraint - see identity-service's opaque-reference precedent
 *     for how per-service constraints remain enforced even when cross-service pre-checks
 *     degrade), which is itself BLOCKED in this batch for the same reason (see
 *     routes/company-requests.routes.ts's header comment). The only practical consequence today
 *     is a superadmin might see two pending requests for the same company name and have to reject
 *     one manually - not a data-integrity or security issue.
 *   Minimum change: this client, gracefully returning null (meaning "unknown, not confirmed
 *     duplicate") until Tenant Directory Service exists and exposes this lookup - exactly the
 *     graceful-null pattern already established by identity-service's own
 *     services/tenantDirectoryClient.ts and services/marketplaceClient.ts.
 *
 * Batch 11 update: Tenant Directory Service now exists, and this file gained two more functions -
 * createCompany/deactivateCompany - for the approve saga (see routes/company-requests.routes.ts's
 * header comment for the full saga design). These do NOT use the graceful-null contract above:
 * companyNameExists is a soft pre-check (skipping it safely degrades to "ask again at approval
 * time"), but createCompany/deactivateCompany are saga steps whose success or failure the caller
 * MUST be able to distinguish to drive correct compensating behavior - silently returning
 * null/false on failure would hide exactly the information the saga needs to act on.
 */
import { logger } from '../utils/logger.js';

const TENANT_DIRECTORY_SERVICE_URL = process.env.TENANT_DIRECTORY_SERVICE_URL || null;
const REQUEST_TIMEOUT_MS = 2000;

export interface RemoteCompany {
  id: number;
  name: string;
  industry: string | null;
  plan: string;
  seats_limit: number;
  is_active: boolean;
  company_slug: string;
  logo_url: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

/** Returns true if a company with this name is known to exist, false if known not to, or null if unknown (service unavailable/not yet built). */
export async function companyNameExists(name: string): Promise<boolean | null> {
  if (!TENANT_DIRECTORY_SERVICE_URL) {
    // Not configured - the expected state until Tenant Directory Service exists (Batch 11).
    return null;
  }

  try {
    const response = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies/exists?name=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { exists: boolean };
    return body.exists;
  } catch (error: any) {
    logger.warn({ err: error?.message, name }, 'Tenant Directory Service company-name lookup failed - treating as unknown');
    return null;
  }
}

/**
 * Graceful-null read (unlike createCompany/deactivateCompany below) - used only to enrich the
 * approve response with full company detail when resuming an already-checkpointed saga (see
 * routes/company-requests.routes.ts). If this fails, the saga's durable state
 * (resulting_company_id) is unaffected - the response just omits full company detail, which is
 * acceptable for a resumed-retry edge case.
 */
export async function getCompanyById(id: number): Promise<RemoteCompany | null> {
  if (!TENANT_DIRECTORY_SERVICE_URL) return null;
  try {
    const response = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies/${id}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as RemoteCompany;
  } catch (error: any) {
    logger.warn({ err: error?.message, id }, 'Tenant Directory Service company-by-id lookup failed');
    return null;
  }
}

export type CreateCompanyResult = { ok: true; company: RemoteCompany } | { ok: false; error: string };

/** Saga step 1 of approve. Explicit success/failure result (not graceful-null) - see header comment. */
export async function createCompany(params: { name: string; industry?: string | null; website?: string | null }): Promise<CreateCompanyResult> {
  if (!TENANT_DIRECTORY_SERVICE_URL) {
    return { ok: false, error: 'Tenant Directory Service is not configured (TENANT_DIRECTORY_SERVICE_URL unset)' };
  }
  try {
    const response = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: (body as any)?.error || `Tenant Directory Service returned HTTP ${response.status}` };
    }
    return { ok: true, company: body as RemoteCompany };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Tenant Directory Service unreachable' };
  }
}

/**
 * Saga compensating action: deactivates a company that was just created, when a LATER saga step
 * (user creation) fails. Returns false on failure - the caller (the approve route) is
 * responsible for logging this loudly, since a failed compensation leaves a real orphaned
 * company record that needs manual operator cleanup. This is the one place in this saga where a
 * failure cannot be automatically retried away, and that limitation is deliberately surfaced, not
 * hidden.
 */
export async function deactivateCompany(companyId: number): Promise<boolean> {
  if (!TENANT_DIRECTORY_SERVICE_URL) return false;
  try {
    const response = await fetch(`${TENANT_DIRECTORY_SERVICE_URL}/internal/companies/${companyId}/deactivate`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch (error: any) {
    logger.error({ err: error?.message, companyId }, 'Failed to deactivate company as a compensating action - manual operator cleanup required');
    return false;
  }
}
