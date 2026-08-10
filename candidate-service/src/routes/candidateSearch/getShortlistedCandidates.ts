/**
 * Get Shortlisted Candidates (Local Implementation)
 *
 * Previously: Proxied to monolith's getShortlistedCandidateAccounts()
 * Now: Implemented locally by fanning out to 2 services:
 * 1. Get latest matched swipes from matching-decision-service (action=1)
 * 2. Get candidate details from candidate-core-service
 * 3. Get candidate accounts from local DB (candidate-service owns this)
 * Then: Merge results and return in search result format
 *
 * This endpoint powers the "Shortlisted" tab on the candidate search page.
 */

import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';
import { getLatestSwipesPerPair } from '../../services/matchingDecisionServiceClient.js';
import { getCandidatesByIds } from '../../services/candidateCoreServiceClient.js';

export interface ShortlistedCandidateResult {
  candidate_id: number;
  candidate_account_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  skills?: string;
  experience_years?: number;
  matched_jobs_count: number;
  latest_match_date: string;
}

/**
 * Fetch shortlisted candidates for a company
 *
 * @param companyId Company to fetch candidates for
 * @returns Array of shortlisted candidate results
 */
export async function getShortlistedCandidates(companyId: number): Promise<ShortlistedCandidateResult[]> {
  try {
    // Step 1: Get latest matched swipes (action=1 means accepted/matched)
    const matchedSwipes = await getLatestSwipesPerPair(companyId, 1);

    if (matchedSwipes.length === 0) {
      logger.debug({ companyId }, 'No matched swipes for company');
      return [];
    }

    // Step 2: Extract unique candidate IDs
    const candidateIds = Array.from(new Set(matchedSwipes.map((s) => s.candidate_id)));

    // Step 3: Get candidate details from candidate-core-service
    const candidateDetails = await getCandidatesByIds(candidateIds);

    // Step 4: Get candidate accounts from local DB
    const accountsResult = await db.query(
      `
      SELECT
        id as candidate_account_id,
        candidate_id,
        first_name,
        last_name,
        email,
        phone
      FROM candidate_accounts
      WHERE candidate_id = ANY($1)
      `,
      [candidateIds]
    );

    const accountsById = new Map(accountsResult.rows.map((row: any) => [row.candidate_id, row]));

    // Step 5: Merge results
    const results: ShortlistedCandidateResult[] = [];

    for (const candidateId of candidateIds) {
      const account = accountsById.get(candidateId);
      const details = candidateDetails.get(candidateId);

      if (!account || !details) continue;

      // Count how many jobs this candidate matched for
      const matchCount = matchedSwipes.filter((s) => s.candidate_id === candidateId).length;

      // Get latest match date
      const latestMatch = matchedSwipes
        .filter((s) => s.candidate_id === candidateId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

      results.push({
        candidate_id: candidateId,
        candidate_account_id: account.candidate_account_id,
        first_name: account.first_name || details.first_name,
        last_name: account.last_name || details.last_name,
        email: account.email || details.email,
        phone: account.phone || details.phone,
        skills: details.skills,
        experience_years: details.experience_years,
        matched_jobs_count: matchCount,
        latest_match_date: latestMatch?.created_at || new Date().toISOString(),
      });
    }

    logger.debug({ companyId, resultCount: results.length }, 'Fetched shortlisted candidates');

    return results;
  } catch (error) {
    logger.error({ err: (error as Error).message, companyId }, 'Failed to get shortlisted candidates');
    throw error;
  }
}
