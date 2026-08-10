/**
 * Shadow-validation for Candidate Service (Batch 16), following the exact same discipline as
 * src/shadowRead.ts and src/jdParserShadow.ts (Phase 11 section 12's methodology). For a real
 * GET /candidate-profile/me request the monolith is already handling, also ask Candidate Service
 * the same question and compare answers, without ever using its answer for anything user-facing.
 *
 * Scope: profile reads only (the single highest-value, most representative read on this service -
 * same reasoning shadowRead.ts's own header comment gives for starting with staff login only).
 * Extending to the proxied routes (jobs/decisions/applications/matches) would mostly be
 * re-validating that the monolith agrees with itself through an extra network hop, since those
 * routes call back into the same monolith code - lower value than proving the genuinely-moved
 * data (candidate_accounts profile columns, candidate_experiences) is correct.
 *
 * HARD RULES - identical to every other shadow module in this codebase:
 *   1. Disabled by default (SHADOW_CANDIDATE_ENABLED must be exactly 'true').
 *   2. Never affects the response already sent to the real user - only ever invoked via
 *      `res.on('finish', ...)`, strictly after the monolith's own response has already gone out.
 *   3. Never throws. A shadow-call failure is logged at warn, not error - it says nothing about
 *      correctness, only that the comparison itself was incomplete.
 */
import { logger } from './utils/logger.js';

export const SHADOW_CANDIDATE_ENABLED = process.env.SHADOW_CANDIDATE_ENABLED === 'true';

const CANDIDATE_SERVICE_URL = process.env.CANDIDATE_SERVICE_URL || '';
const REQUEST_TIMEOUT_MS = 5000;

// Every field, including the nested `completion` object, is expected to match exactly -
// candidate-service's toProfileResponse/computeCompletion (src/routes/candidateProfile.routes.ts)
// is a direct, unmodified port of the monolith's own, so real divergence here is a real bug, not
// an expected difference (unlike jdParserShadow.ts's parseTimeMs, there's no field here that's
// supposed to differ between a local call and a network round-trip).
function diffProfileFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const mismatched: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) mismatched.push(key);
  }
  return mismatched;
}

/**
 * Re-fetches the candidate's own profile from Candidate Service and compares it to what the
 * monolith already computed (and already responded to the real user with). Fire-and-forget by
 * design - call this without awaiting it. `accessToken` is the caller's own already-verified
 * candidate_access_token cookie value, forwarded so the shadow call passes Candidate Service's
 * own requireCandidateAuth exactly as a real proxied request through API Gateway would.
 */
export async function shadowGetCandidateProfile(candidateAccountId: number, monolithProfile: Record<string, unknown>, accessToken: string): Promise<void> {
  if (!SHADOW_CANDIDATE_ENABLED) return;
  if (!CANDIDATE_SERVICE_URL) {
    logger.warn('SHADOW_CANDIDATE_ENABLED is true but CANDIDATE_SERVICE_URL is not set - skipping this shadow-validation.');
    return;
  }

  try {
    const response = await fetch(`${CANDIDATE_SERVICE_URL}/api/candidate-profile/me`, {
      method: 'GET',
      headers: { Cookie: `candidate_access_token=${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, candidateAccountId }, 'Shadow-validation call to candidate-service returned a non-OK status - comparison skipped');
      return;
    }

    const candidateServiceProfile = await response.json();
    const mismatchedFields = diffProfileFields(monolithProfile, candidateServiceProfile);

    if (mismatchedFields.length > 0) {
      logger.error(
        { candidateAccountId, mismatchedFields, monolith: monolithProfile, candidateService: candidateServiceProfile },
        'SHADOW-VALIDATION DIVERGENCE: monolith and candidate-service disagreed on this candidate\'s profile'
      );
      return;
    }

    logger.debug({ candidateAccountId }, 'Shadow-validation agreement: candidate-service matched the monolith for this profile');
  } catch (error: any) {
    logger.warn({ err: error?.message, candidateAccountId }, 'Shadow-validation call to candidate-service failed - comparison skipped');
  }
}
