/**
 * Get Candidate Decisions (Local Implementation)
 *
 * Migration: Phase 1, Sprint 1.5
 * Previously: Proxied to monolith GET /api/candidate-decisions
 * Now: Implemented locally in candidate-service (owns decision history)
 *
 * This endpoint returns recruiter decisions on candidates:
 * - Decision records from candidate_decisions table
 * - Scoped by company_id
 * - Includes decision type, date, recruiter info, notes
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';

export interface CandidateDecision {
  id: number;
  company_id: number;
  candidate_id: number;
  recruiter_id?: number | null;
  decision_type?: string | null;
  decision_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get candidate decisions (all for company, or filtered by candidate)
 * @param companyId Company ID (for scope isolation)
 * @param candidateId Optional candidate ID (to filter by specific candidate)
 * @returns Array of decision records
 */
export async function getCandidateDecisions(
  companyId: number,
  candidateId?: number
): Promise<CandidateDecision[]> {
  try {
    const query = `
      SELECT
        id,
        company_id,
        candidate_id,
        recruiter_id,
        decision_type,
        decision_date,
        notes,
        created_at,
        updated_at
      FROM candidate_decisions
      WHERE company_id = $1
      ${candidateId ? 'AND candidate_id = $2' : ''}
      ORDER BY created_at DESC
    `;

    const params = candidateId ? [companyId, candidateId] : [companyId];
    const result = await db.query(query, params);

    logger.debug(
      { companyId, candidateId, decisionCount: result.rows.length },
      'Fetched candidate decisions'
    );

    return result.rows;
  } catch (error) {
    logger.error(
      { err: (error as Error).message, companyId, candidateId },
      'Failed to get candidate decisions'
    );
    throw error;
  }
}
