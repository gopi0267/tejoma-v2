/**
 * Internal Endpoints: Latest Swipes Per Pair
 *
 * Used by:
 * - Item 2: candidate-service (shortlisted tab)
 * - Item 5: matching-decision-service CQRS backfill
 *
 * Pattern: Fire-and-forget, fast, no caching
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';

const router = Router();

/**
 * GET /internal/swipes/latest-per-pair?companyId=123&action=1
 *
 * Returns the latest swipe per (candidate_id, job_id) pair for a company.
 * Optionally filtered by action (e.g., action=1 for accepted swipes).
 *
 * Used for shortlisted tab: action=1 means "matched/accepted"
 *
 * Response: [
 *   { candidate_id: 1, job_id: 2, action: 1, created_at: "2024-08-10T...", ... },
 *   ...
 * ]
 */
router.get('/latest-per-pair', async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.query.companyId as string);
    const action = req.query.action ? parseInt(req.query.action as string) : undefined;

    if (!companyId || companyId <= 0) {
      return res.status(400).json({ error: 'companyId is required and must be positive' });
    }

    // DISTINCT ON pattern: Get the latest swipe per pair
    let query = `
      SELECT DISTINCT ON (candidate_id, job_id)
        id,
        candidate_id,
        job_id,
        company_id,
        action,
        score,
        reason,
        created_at,
        updated_at
      FROM swipes
      WHERE company_id = $1
    `;

    const params: any[] = [companyId];

    if (action !== undefined) {
      query += ` AND action = $${params.length + 1}`;
      params.push(action);
    }

    query += `
      ORDER BY candidate_id, job_id, created_at DESC
    `;

    const result = await db.query(query, params);

    const swipes = result.rows.map((row: any) => ({
      id: row.id,
      candidate_id: row.candidate_id,
      job_id: row.job_id,
      company_id: row.company_id,
      action: row.action,
      score: parseFloat(row.score),
      reason: row.reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(swipes);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get latest swipes per pair');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
