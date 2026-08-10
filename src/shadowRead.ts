/**
 * Shadow-read comparison for the Tier 0 migration (Phase 11 section 12's methodology: backfill ->
 * dual-write -> shadow-read -> validate -> cutover -> rollback -> legacy removal). Batch 13a built
 * backfill, Batch 13b built dual-write; this is the third step - for a real request the monolith
 * is already handling, also ask the new service the same question and compare answers, without
 * ever using the new service's answer for anything user-facing. This is how a genuine read-path
 * bug (not just a data-sync bug, which validate-*-sync.ts already catches) gets caught BEFORE any
 * real traffic depends on the new service's answer being correct - "test in production" with zero
 * risk, since the monolith's own answer is always what the real user actually receives.
 *
 * Scope: staff login only (src/api/auth.routes.ts's POST /auth/login) - the single highest-value,
 * most representative auth read path. Every other route (candidate login, refresh, /me) would
 * follow the identical pattern; building all of them now, before this one has even been run
 * against real traffic, would be exactly the "build ahead of evidence" this series has
 * consistently avoided (see e.g. Batch 9's src/utils/logger.ts duplication reasoning for the same
 * principle applied elsewhere). Extending to more routes is mechanical once this one has proven
 * itself.
 *
 * HARD RULES - identical to src/dualWrite.ts's, applied to reads instead of writes:
 *   1. Disabled by default (SHADOW_READ_ENABLED must be exactly 'true').
 *   2. Never affects the response already sent to the real user - this module is only ever
 *      invoked via `res.on('finish', ...)`, i.e. strictly after the monolith's own response has
 *      already gone out over the wire.
 *   3. Never throws, never logs the plaintext password - only pass/fail and non-secret identity
 *      fields (user id, role, company id) ever reach the log.
 */
import { logger } from './utils/logger.js';

export const SHADOW_READ_ENABLED = process.env.SHADOW_READ_ENABLED === 'true';

const IDENTITY_SERVICE_URL = process.env.IDENTITY_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 3000;

export type LoginOutcome =
  | { success: false; reason: 'invalid_identifier_format' | 'unknown_identifier' | 'registration_pending' | 'registration_rejected' | 'account_deactivated' | 'wrong_password' }
  | { success: true; userId: number; role: string; companyId: number };

/**
 * Re-issues the same login attempt against Identity Service and compares the outcome to what the
 * monolith already decided (and already responded to the real user with). Fire-and-forget by
 * design - call this without awaiting it.
 */
export async function shadowReadLogin(identifier: string, password: string, monolithOutcome: LoginOutcome): Promise<void> {
  if (!SHADOW_READ_ENABLED) return;
  if (!IDENTITY_SERVICE_URL) {
    logger.warn('SHADOW_READ_ENABLED is true but IDENTITY_SERVICE_URL is not set - skipping this shadow-read.');
    return;
  }

  try {
    const response = await fetch(`${IDENTITY_SERVICE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const identitySucceeded = response.status === 200;
    const body = await response.json().catch(() => ({}) as any);

    if (monolithOutcome.success !== identitySucceeded) {
      logger.error(
        { monolith: summarize(monolithOutcome), identityService: { success: identitySucceeded, status: response.status, error: body?.error } },
        'SHADOW-READ DIVERGENCE: monolith and Identity Service disagreed on whether this login should succeed'
      );
      return;
    }

    if (monolithOutcome.success && identitySucceeded) {
      const mismatch: string[] = [];
      if (body?.user_info?.id !== monolithOutcome.userId) mismatch.push('user_id');
      if (body?.user_info?.role !== monolithOutcome.role) mismatch.push('role');
      if (body?.company_id !== monolithOutcome.companyId) mismatch.push('company_id');

      if (mismatch.length > 0) {
        logger.error(
          { monolith: summarize(monolithOutcome), identityService: { userId: body?.user_info?.id, role: body?.user_info?.role, companyId: body?.company_id }, mismatchedFields: mismatch },
          'SHADOW-READ DIVERGENCE: both services agreed the login succeeds, but returned different identity fields'
        );
        return;
      }
    }

    logger.debug({ monolith: summarize(monolithOutcome) }, 'Shadow-read agreement: Identity Service matched the monolith for this login');
  } catch (error: any) {
    // A shadow-read failure (timeout, Identity Service down) is NOT a divergence - it's just an
    // incomplete comparison. Logged at warn, not error, since it says nothing about correctness.
    logger.warn({ err: error?.message }, 'Shadow-read call to Identity Service failed - comparison skipped for this login');
  }
}

function summarize(outcome: LoginOutcome): Record<string, unknown> {
  return outcome.success ? { success: true, userId: outcome.userId, role: outcome.role, companyId: outcome.companyId } : { success: false, reason: outcome.reason };
}
