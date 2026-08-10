/**
 * Get Candidate Detail (Local Implementation)
 *
 * Migration: Phase 1, Sprint 1.1
 * Previously: Proxied to monolith GET /api/candidates/:id
 * Now: Implemented locally in candidate-core-service (owns candidates)
 *
 * This endpoint returns complete candidate profile:
 * - Basic info (email, phone, name)
 * - Skills inventory
 * - Experience years
 * - Education
 * - Location
 * - Profile metadata (created_at, updated_at)
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';

export interface CandidateDetailResponse {
  id: number;
  company_id: number;
  email: string;
  phone?: string;
  first_name: string;
  last_name: string;
  skills: string[];
  experience_years: number;
  education?: string;
  location?: string;
  headline?: string;
  summary?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get candidate detail by ID
 * @param candidateId Candidate ID
 * @param companyId Company ID (for scope isolation)
 * @returns Candidate profile or null if not found
 */
export async function getCandidateDetail(
  candidateId: number,
  companyId: number
): Promise<CandidateDetailResponse | null> {
  try {
    // Query candidate from local DB
    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        email,
        phone,
        first_name,
        last_name,
        skills,
        experience_years,
        education,
        location,
        headline,
        summary,
        created_at,
        updated_at
      FROM candidates
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
      `,
      [candidateId, companyId]
    );

    if (result.rows.length === 0) {
      logger.debug({ candidateId, companyId }, 'Candidate not found');
      return null;
    }

    const row = result.rows[0];

    logger.debug({ candidateId, companyId }, 'Fetched candidate detail');

    return {
      id: row.id,
      company_id: row.company_id,
      email: row.email,
      phone: row.phone,
      first_name: row.first_name,
      last_name: row.last_name,
      skills: Array.isArray(row.skills)
        ? row.skills
        : row.skills
          ? JSON.parse(row.skills)
          : [],
      experience_years: row.experience_years || 0,
      education: row.education,
      location: row.location,
      headline: row.headline,
      summary: row.summary,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error(
      { err: (error as Error).message, candidateId, companyId },
      'Failed to get candidate detail'
    );
    throw error;
  }
}
