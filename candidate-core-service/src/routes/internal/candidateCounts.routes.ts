/**
 * Internal Endpoints: Candidate Counts
 *
 * Used by: job-service to enrich job listings with active candidate counts
 * Pattern: Fire-and-forget, fast, no caching
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';

const router = Router();

/**
 * GET /internal/candidates/count?companyId=123
 *
 * Returns total count of active candidates for a given company.
 * Used on job listing to show "X active candidates" metric.
 *
 * Response: { count: 1234 }
 */
router.get('/count', async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.query.companyId as string);

    if (!companyId || companyId <= 0) {
      return res.status(400).json({ error: 'companyId is required and must be positive' });
    }

    const result = await db.query(
      `
      SELECT COUNT(*) as count
      FROM candidates
      WHERE company_id = $1 AND deleted_at IS NULL
      `,
      [companyId]
    );

    const count = parseInt(result.rows[0].count);

    res.json({ count });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get candidate count');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
