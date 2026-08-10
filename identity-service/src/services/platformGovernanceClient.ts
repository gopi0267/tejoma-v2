/**
 * Client for Platform Governance Service's company-registration-request lookup - closes the
 * "Differentiated pending/rejected registration login error messaging - deferred to Platform
 * Governance Service" item noted in this service's own routes/auth.routes.ts header comment
 * since Batch 6. Platform Governance Service now exists (Batch 10), so this is wired for real,
 * not another graceful-null stub.
 *
 * Still gracefully degrades to null if Platform Governance Service is unreachable at request
 * time (network blip, deploy in progress, etc.) - a staff login must never fail outright just
 * because a secondary, differentiating-message-only lookup couldn't complete. The fallback
 * behavior (generic "Invalid email or password") is identical to what happens today when no
 * request exists at all, so degrading is safe, not just convenient.
 */
import { logger } from '../utils/logger.js';

const PLATFORM_GOVERNANCE_SERVICE_URL = process.env.PLATFORM_GOVERNANCE_SERVICE_URL || null;
const REQUEST_TIMEOUT_MS = 2000;

export async function getRegistrationStatusByIdentifier(identifier: { type: 'email' | 'phone'; value: string }): Promise<'pending' | 'approved' | 'rejected' | null> {
  if (!PLATFORM_GOVERNANCE_SERVICE_URL) {
    return null;
  }

  try {
    const query = new URLSearchParams({ type: identifier.type, value: identifier.value });
    const response = await fetch(`${PLATFORM_GOVERNANCE_SERVICE_URL}/internal/company-requests/by-identifier?${query.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // A 404 here means "no request found for this identifier" (Platform Governance Service's own
    // documented contract) - a real, valid answer, not a failure.
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const body = (await response.json()) as { status: 'pending' | 'approved' | 'rejected' | null };
    return body.status;
  } catch (error: any) {
    logger.warn({ err: error?.message }, 'Platform Governance Service registration-status lookup failed - falling back to generic login error');
    return null;
  }
}
