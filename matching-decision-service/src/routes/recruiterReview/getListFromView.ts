/**
 * Get Recruiter Review List from Materialized View (Local Implementation)
 *
 * Previously: 5-table join in monolith (swipes + recruiter_notes + candidates +
 *             jobs + users), with LIMIT/OFFSET pagination (unreliable at scale)
 * Now: Query the recruiter_review_view materialized table, pagination safe
 *
 * The view is kept fresh via dual-write hooks from 4 owning services:
 * - candidate-core-service (candidate changes)
 * - job-service (job changes)
 * - identity-service (recruiter name changes)
 * - matching-decision-service (swipe/note/decision writes)
 */

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';

export interface RecruiterReviewListFilter {
  companyId: number;
  action?: number; // 1 = interested, 0 = not interested
  recruiterId?: number;
  search?: string; // ILIKE search across candidate_name, candidate_email, job_title, recruiter_name
}

export interface RecruiterReviewListSort {
  field: 'decision_date' | 'score' | 'created_at'; // supported sort fields
  order: 'ASC' | 'DESC';
}

export interface RecruiterReviewListOptions {
  limit?: number;
  offset?: number;
  sort?: RecruiterReviewListSort;
}

export interface RecruiterReviewListRow {
  id: number;
  candidate_id: number;
  candidate_name: string;
  candidate_email: string;
  candidate_phone?: string;
  candidate_skills: string[];
  candidate_experience_years?: number;
  job_id: number;
  job_title: string;
  job_required_skills: string[];
  job_location?: string;
  recruiter_id?: number;
  recruiter_name?: string;
  action: number;
  score: number;
  reason?: string;
  recruiter_note?: string;
  decision_date?: Date;
  swipe_created_at: Date;
}

export async function getRecruiterReviewList(
  filter: RecruiterReviewListFilter,
  options: RecruiterReviewListOptions = {}
): Promise<{
  rows: RecruiterReviewListRow[];
  total: number;
}> {
  try {
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const sort = options.sort || { field: 'decision_date', order: 'DESC' };

    // Build WHERE clause
    const whereClauses = ['company_id = $1'];
    const params: unknown[] = [filter.companyId];
    let paramCount = 2;

    if (filter.action !== undefined) {
      whereClauses.push(`action = $${paramCount}`);
      params.push(filter.action);
      paramCount++;
    }

    if (filter.recruiterId !== undefined) {
      whereClauses.push(`recruiter_id = $${paramCount}`);
      params.push(filter.recruiterId);
      paramCount++;
    }

    if (filter.search) {
      // Use pg_trgm GIN index for ILIKE search
      const searchPattern = `%${filter.search}%`;
      whereClauses.push(
        `(candidate_name ILIKE $${paramCount} OR candidate_email ILIKE $${paramCount + 1} OR job_title ILIKE $${paramCount + 2} OR recruiter_name ILIKE $${paramCount + 3})`
      );
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      paramCount += 4;
    }

    const whereClause = whereClauses.join(' AND ');

    // Validate sort field (prevent SQL injection)
    const validSortFields = ['decision_date', 'score', 'created_at'];
    if (!validSortFields.includes(sort.field)) {
      logger.warn({ sort }, 'Invalid sort field, using default');
      sort.field = 'decision_date';
    }

    const orderClause = `ORDER BY ${sort.field} ${sort.order} NULLS LAST`;

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM recruiter_review_view WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get paginated rows
    const sql = `
      SELECT
        id, candidate_id, candidate_name, candidate_email, candidate_phone,
        candidate_skills, candidate_experience_years,
        job_id, job_title, job_required_skills, job_location,
        recruiter_id, recruiter_name,
        action, score, reason, recruiter_note,
        decision_date, swipe_created_at
      FROM recruiter_review_view
      WHERE ${whereClause}
      ${orderClause}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    params.push(limit, offset);

    const result = await db.query(sql, params);

    logger.debug(
      { companyId: filter.companyId, count: result.rows.length, total },
      'Fetched recruiter review list from view'
    );

    return {
      rows: result.rows as RecruiterReviewListRow[],
      total,
    };
  } catch (error) {
    logger.error(
      { err: (error as Error).message, filter },
      'Failed to get recruiter review list from view'
    );
    throw error;
  }
}

/**
 * Get a single row from the view (for detail page initial load)
 */
export async function getRecruiterReviewViewRow(
  companyId: number,
  candidateId: number,
  jobId: number
): Promise<RecruiterReviewListRow | null> {
  try {
    const result = await db.query(
      `
      SELECT
        id, candidate_id, candidate_name, candidate_email, candidate_phone,
        candidate_skills, candidate_experience_years,
        job_id, job_title, job_required_skills, job_location,
        recruiter_id, recruiter_name,
        action, score, reason, recruiter_note,
        decision_date, swipe_created_at
      FROM recruiter_review_view
      WHERE company_id = $1 AND candidate_id = $2 AND job_id = $3
      `,
      [companyId, candidateId, jobId]
    );

    return result.rows[0] || null;
  } catch (error) {
    logger.error(
      { err: (error as Error).message, companyId, candidateId, jobId },
      'Failed to get recruiter review view row'
    );
    throw error;
  }
}
