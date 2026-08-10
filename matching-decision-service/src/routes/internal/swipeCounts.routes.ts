/**
 * Internal Endpoints: Swipe Counts by Job
 *
 * Used by: job-service to enrich job listings with match counts
 * Pattern: Fire-and-forget, fast, no caching
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';

const router = Router();

/**
 * GET /internal/swipes/counts-by-job?companyId=123
 *
 * Returns swipe counts aggregated by job_id for a given company.
 * Used to show "X candidates matched this job" on job listings.
 *
 * Response: [{ job_id: 1, count: 42 }, { job_id: 2, count: 18 }, ...]
 */
router.get('/counts-by-job', async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.query.companyId as string);

    if (!companyId || companyId <= 0) {
      return res.status(400).json({ error: 'companyId is required and must be positive' });
    }

    const result = await db.query(
      `
      SELECT
        job_id,
        COUNT(*) as count
      FROM swipes
      WHERE company_id = $1
      GROUP BY job_id
      ORDER BY job_id
      `,
      [companyId]
    );

    const counts = result.rows.map((row: any) => ({
      job_id: row.job_id,
      count: parseInt(row.count),
    }));

    res.json(counts);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get swipe counts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
