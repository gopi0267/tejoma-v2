/**
 * Get Candidate Resume Detail (Local Implementation)
 *
 * Migration: Phase 1, Sprint 1.2
 * Previously: Proxied to monolith GET /api/candidates/:id/resume
 * Now: Implemented locally in candidate-core-service (owns candidates)
 *
 * This endpoint returns complete resume content:
 * - Resume text (full parsed resume)
 * - Resume summary (AI-generated summary)
 * - Resume file path (for download)
 * - Resume embedding (for similarity search)
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';

export interface ResumeDetailResponse {
  id: number;
  candidate_id: number;
  resume_text: string;
  resume_summary: string;
  resume_file_path?: string | null;
  resume_original_filename?: string | null;
  resume_embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get candidate resume detail by ID
 * @param candidateId Candidate ID
 * @param companyId Company ID (for scope isolation)
 * @returns Resume content or null if not found
 */
export async function getResumeDetail(
  candidateId: number,
  companyId: number
): Promise<ResumeDetailResponse | null> {
  try {
    // Query candidate resume from local DB
    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        resume_text,
        resume_summary,
        resume_file_path,
        resume_original_filename,
        resume_embedding,
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

    logger.debug({ candidateId, companyId }, 'Fetched candidate resume detail');

    return {
      id: row.id,
      candidate_id: row.id,
      resume_text: row.resume_text || '',
      resume_summary: row.resume_summary || '',
      resume_file_path: row.resume_file_path,
      resume_original_filename: row.resume_original_filename,
      resume_embedding: row.resume_embedding,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error(
      { err: (error as Error).message, candidateId, companyId },
      'Failed to get candidate resume detail'
    );
    throw error;
  }
}
