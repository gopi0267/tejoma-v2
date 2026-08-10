/**
 * Client for Marketplace Service's candidate-profile lookup API - the cross-service replacement
 * for reading candidate_accounts' profile columns (headline, skills, years_of_experience,
 * location, education, summary, onboarding_completed_at) directly.
 *
 * IMPLEMENTATION ISSUE, resolved per the required methodology (see this batch's own notes and
 * candidate-auth.routes.ts's header comment for the full writeup):
 *   Problem: the monolith's candidate-auth responses (login/refresh/me) include full profile
 *     fields alongside auth fields in one object.
 *   Why it exists: candidate_accounts is one table in the monolith, holding both.
 *   Impact: Identity DB's candidate_accounts (Batch 3) is the auth-column slice only (Phase
 *     3(database) section 4's split) - Identity Service cannot return profile fields, since they
 *     don't exist in its database. This is a LARGER gap than the Tenant Directory company lookup
 *     (Batch 4): it's the primary shape the candidate frontend renders from, not a secondary
 *     enrichment field.
 *   Minimum change: return the auth-owned fields now; profile enrichment via this client, which
 *     gracefully returns null until Marketplace Service exists - and Marketplace Service is Tier
 *     1 scope, outside this document's Tier 0 boundary entirely. Real candidate-auth cutover is
 *     correctly gated on Tier 1, not just this service - tracked explicitly as a Tier 0 exit
 *     caveat, not silently glossed over.
 */
import { logger } from '../utils/logger.js';

const MARKETPLACE_SERVICE_URL = process.env.MARKETPLACE_SERVICE_URL || null;
const REQUEST_TIMEOUT_MS = 2000;

export interface CandidateProfileInfo {
  headline: string | null;
  skills: string[];
  years_of_experience: string | null;
  location: string | null;
  education: string | null;
  summary: string | null;
  onboarding_completed_at: string | null;
}

export async function getCandidateProfile(candidateId: number): Promise<CandidateProfileInfo | null> {
  if (!MARKETPLACE_SERVICE_URL) {
    // Not configured - the expected state until Marketplace Service exists (Tier 1, out of this
    // document's scope). Not an error, just an unavailable enrichment.
    return null;
  }

  try {
    const response = await fetch(`${MARKETPLACE_SERVICE_URL}/internal/candidate-profiles/${candidateId}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as CandidateProfileInfo;
  } catch (error: any) {
    logger.warn({ err: error?.message, candidateId }, 'Marketplace Service candidate profile lookup failed - returning null enrichment');
    return null;
  }
}
