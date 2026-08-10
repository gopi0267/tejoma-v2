/**
 * Recruiter Review View - Materialized Read Model Management
 *
 * Provides functions to upsert and maintain the recruiter_review_view
 * table that powers GET /api/recruiter-review (list).
 *
 * Called from:
 * 1. Swipe write paths (in-process, immediate)
 * 2. Cross-service refresh hooks (async, best-effort)
 */

import { db } from '../db.js';
import { logger } from '../utils/logger.js';

export interface RecruiterReviewViewRow {
  company_id: number;
  candidate_id: number;
  job_id: number;
  candidate_email?: string;
  candidate_name?: string;
  candidate_phone?: string;
  candidate_skills?: string[];
  candidate_experience_years?: number;
  job_title?: string;
  job_required_skills?: string[];
  job_location?: string;
  recruiter_id?: number;
  recruiter_name?: string;
  recruiter_email?: string;
  action?: number;
  score?: number;
  reason?: string;
  recruiter_note?: string;
  decision_date?: Date;
  swipe_created_at?: Date;
  swipe_updated_at?: Date;
}

/**
 * Upsert a row into the recruiter_review_view.
 * Called in-process after swipe/decision/note writes in matching-decision-service.
 *
 * @param row Data to upsert
 */
export async function upsertRecruiterReviewViewRow(row: RecruiterReviewViewRow): Promise<void> {
  try {
    // Build column list and values dynamically (omit undefined fields)
    const columns: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    const fieldMap: Record<keyof RecruiterReviewViewRow, string> = {
      company_id: '$' + paramCount++,
      candidate_id: '$' + paramCount++,
      job_id: '$' + paramCount++,
      candidate_email: '$' + paramCount++,
      candidate_name: '$' + paramCount++,
      candidate_phone: '$' + paramCount++,
      candidate_skills: '$' + paramCount++,
      candidate_experience_years: '$' + paramCount++,
      job_title: '$' + paramCount++,
      job_required_skills: '$' + paramCount++,
      job_location: '$' + paramCount++,
      recruiter_id: '$' + paramCount++,
      recruiter_name: '$' + paramCount++,
      recruiter_email: '$' + paramCount++,
      action: '$' + paramCount++,
      score: '$' + paramCount++,
      reason: '$' + paramCount++,
      recruiter_note: '$' + paramCount++,
      decision_date: '$' + paramCount++,
      swipe_created_at: '$' + paramCount++,
      swipe_updated_at: '$' + paramCount++,
    };

    for (const [key, value] of Object.entries(row)) {
      if (value !== undefined) {
        columns.push(key);
        values.push(value);
      }
    }

    if (columns.length === 0) {
      logger.debug('No fields to upsert for recruiter_review_view');
      return;
    }

    // Build UPSERT query
    const columnList = columns.join(', ');
    const valueList = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateList = columns
      .filter((c) => c !== 'company_id' && c !== 'candidate_id' && c !== 'job_id')
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const sql = `
      INSERT INTO recruiter_review_view (${columnList}, updated_at)
      VALUES (${valueList}, CURRENT_TIMESTAMP)
      ON CONFLICT (company_id, candidate_id, job_id) DO UPDATE SET
        ${updateList},
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `;

    await db.query(sql, values);
    logger.debug(
      { company_id: row.company_id, candidate_id: row.candidate_id, job_id: row.job_id },
      'Upserted recruiter_review_view row'
    );
  } catch (error) {
    logger.error(
      { err: (error as Error).message, row },
      'Failed to upsert recruiter_review_view'
    );
    // Never throw - best-effort sync
  }
}

/**
 * Update recruiter note for a row in recruiter_review_view.
 * Called after recruiter note creation/update.
 *
 * @param companyId Company ID
 * @param candidateId Candidate ID
 * @param jobId Job ID
 * @param note Updated note text
 */
export async function patchRecruiterReviewViewNote(
  companyId: number,
  candidateId: number,
  jobId: number,
  note: string
): Promise<void> {
  try {
    await db.query(
      `
      UPDATE recruiter_review_view
      SET recruiter_note = $1, updated_at = CURRENT_TIMESTAMP
      WHERE company_id = $2 AND candidate_id = $3 AND job_id = $4
      `,
      [note, companyId, candidateId, jobId]
    );

    logger.debug(
      { companyId, candidateId, jobId },
      'Patched recruiter_review_view note'
    );
  } catch (error) {
    logger.error(
      { err: (error as Error).message, companyId, candidateId, jobId },
      'Failed to patch recruiter_review_view note'
    );
  }
}

/**
 * Refresh rows for a candidate (called when candidate data changes).
 * Cross-service hook: called from candidate-core-service on candidate update.
 *
 * @param candidateIds Candidate IDs to refresh
 */
export async function refreshRecruiterReviewViewForCandidates(candidateIds: number[]): Promise<void> {
  if (candidateIds.length === 0) return;

  try {
    const idList = candidateIds.map((_, i) => `$${i + 1}`).join(',');
    await db.query(
      `
      UPDATE recruiter_review_view
      SET updated_at = CURRENT_TIMESTAMP
      WHERE candidate_id = ANY(ARRAY[${idList}])
      `,
      candidateIds
    );

    logger.debug({ candidateIds }, 'Refreshed recruiter_review_view for candidates');
  } catch (error) {
    logger.error(
      { err: (error as Error).message, candidateIds },
      'Failed to refresh recruiter_review_view for candidates'
    );
  }
}

/**
 * Refresh rows for jobs (called when job data changes).
 * Cross-service hook: called from job-service on job update.
 *
 * @param jobIds Job IDs to refresh
 */
export async function refreshRecruiterReviewViewForJobs(jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;

  try {
    const idList = jobIds.map((_, i) => `$${i + 1}`).join(',');
    await db.query(
      `
      UPDATE recruiter_review_view
      SET updated_at = CURRENT_TIMESTAMP
      WHERE job_id = ANY(ARRAY[${idList}])
      `,
      jobIds
    );

    logger.debug({ jobIds }, 'Refreshed recruiter_review_view for jobs');
  } catch (error) {
    logger.error(
      { err: (error as Error).message, jobIds },
      'Failed to refresh recruiter_review_view for jobs'
    );
  }
}

/**
 * Refresh rows for recruiters (called when recruiter data changes).
 * Cross-service hook: called from identity-service on recruiter update.
 *
 * @param recruiterIds Recruiter IDs to refresh
 */
export async function refreshRecruiterReviewViewForRecruiters(recruiterIds: number[]): Promise<void> {
  if (recruiterIds.length === 0) return;

  try {
    const idList = recruiterIds.map((_, i) => `$${i + 1}`).join(',');
    await db.query(
      `
      UPDATE recruiter_review_view
      SET updated_at = CURRENT_TIMESTAMP
      WHERE recruiter_id = ANY(ARRAY[${idList}])
      `,
      recruiterIds
    );

    logger.debug({ recruiterIds }, 'Refreshed recruiter_review_view for recruiters');
  } catch (error) {
    logger.error(
      { err: (error as Error).message, recruiterIds },
      'Failed to refresh recruiter_review_view for recruiters'
    );
  }
}
