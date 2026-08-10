/**
 * Client for Identity Service's user-exists check - the cross-service replacement for the
 * monolith's direct `db.getUserByEmail(...)`/`db.getUserByPhone(...)` calls inside
 * company-registration submission (src/api/company-requests.routes.ts:71-76 in the monolith).
 *
 * IMPLEMENTATION ISSUE, resolved per the required methodology:
 *   Problem: registration submission pre-checks whether the prospective admin's email/phone
 *     already belongs to a `users` row, so a duplicate application gets an immediate, friendly
 *     error.
 *   Why it exists: `users` is owned by Identity Service (Phase 3(database) section 1), a
 *     separate physical database this service must never query directly (Phase 3(database)
 *     section 4's per-service isolation - already applied consistently across this series).
 *   Impact: Identity Service exists today (unlike Tenant Directory Service did in Batch 10), but
 *     did not yet expose an internal existence-check endpoint - Batch 11 added
 *     GET /internal/users/exists to identity-service for exactly this. Until then, skipping this
 *     pre-check was safe for the same reason described in tenantDirectoryClient.ts:
 *     `users.email`/`users.phone` UNIQUE constraints remain the real enforcement.
 *   Minimum change: this client, gracefully returning null if Identity Service is ever
 *     unreachable at request time - the same graceful-null pattern as tenantDirectoryClient.ts's
 *     companyNameExists in this service.
 *
 * Batch 11 also added createStaffUser - the user-creation half of the approve saga (see
 * routes/company-requests.routes.ts's header comment). Like tenantDirectoryClient.ts's
 * createCompany, this does NOT use the graceful-null contract: the saga must be able to
 * distinguish success from failure to act correctly.
 */
import { logger } from '../utils/logger.js';

const IDENTITY_SERVICE_INTERNAL_URL = process.env.IDENTITY_SERVICE_URL || null;
const REQUEST_TIMEOUT_MS = 2000;

/** Returns true if a staff user with this email or phone is known to exist, false if known not to, or null if unknown (service unreachable). */
export async function staffUserExists(params: { email?: string | null; phone?: string | null }): Promise<boolean | null> {
  if (!IDENTITY_SERVICE_INTERNAL_URL) {
    return null;
  }

  try {
    const query = new URLSearchParams();
    if (params.email) query.set('email', params.email);
    if (params.phone) query.set('phone', params.phone);

    const response = await fetch(`${IDENTITY_SERVICE_INTERNAL_URL}/internal/users/exists?${query.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { exists: boolean };
    return body.exists;
  } catch (error: any) {
    logger.warn({ err: error?.message }, 'Identity Service user-exists lookup failed - treating as unknown');
    return null;
  }
}

export interface RemoteStaffUser {
  id: number;
  email: string | null;
  phone: string | null;
  company_id: number;
  role: string;
  is_active: boolean;
  name: string;
  created_at: string;
  updated_at: string;
}

export type CreateStaffUserResult = { ok: true; user: RemoteStaffUser } | { ok: false; error: string };

/** Saga step 2 of approve. Explicit success/failure result (not graceful-null) - see header comment. */
export async function createStaffUser(params: {
  name: string; email: string | null; phone: string | null; passwordHash: string;
  companyId: number; role: 'recruiter' | 'admin' | 'superadmin'; createdBy: number | null;
}): Promise<CreateStaffUserResult> {
  if (!IDENTITY_SERVICE_INTERNAL_URL) {
    return { ok: false, error: 'Identity Service is not configured (IDENTITY_SERVICE_URL unset)' };
  }
  try {
    const response = await fetch(`${IDENTITY_SERVICE_INTERNAL_URL}/internal/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: (body as any)?.error || `Identity Service returned HTTP ${response.status}` };
    }
    return { ok: true, user: body as RemoteStaffUser };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Identity Service unreachable' };
  }
}
