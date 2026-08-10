/**
 * Job Service Routes
 *
 * Handles all job-related endpoints including:
 * - GET /api/jobs - Job list (with feature flag for local vs monolith)
 * - GET /api/jobs/:id - Job detail
 * - POST/PATCH/DELETE - Job mutations
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { getEnrichedJobsList } from './getEnrichedJobsList.js';
import { getJobDetail } from './getJobDetail.js';
import { db } from '../../db.js';

const router = Router();

/**
 * GET /api/jobs
 *
 * List all jobs for a company with enrichment (swipe counts, candidate counts)
 *
 * Feature Flag: JOB_LIST_CUTOVER_ENABLED
 * - true: Use local job-service handler (fans out to matching-decision + candidate-core)
 * - false: Proxy to monolith (safe fallback)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = parseInt((req as any).user?.company_id as string);

    if (!companyId || companyId <= 0) {
      return res.status(400).json({ error: 'Company ID required' });
    }

    // Feature flag: JOB_LIST_CUTOVER_ENABLED
    const useLocalHandler = process.env.JOB_LIST_CUTOVER_ENABLED === 'true';

    if (useLocalHandler) {
      // Use local handler (job-service + matching-decision + candidate-core)
      logger.debug({ companyId }, 'Using local job-service handler for /api/jobs');
      const enrichedJobs = await getEnrichedJobsList(companyId);
      return res.json(enrichedJobs);
    } else {
      // Fallback: Proxy to monolith (safe)
      logger.debug({ companyId }, 'Using monolith proxy for /api/jobs');
      // TODO: Implement monolith proxy call
      return res.json([]);
    }
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'GET /api/jobs failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/jobs/:id
 *
 * Get a single job by ID with ranked candidates
 *
 * Feature Flag: JOB_DETAIL_CUTOVER_ENABLED (Phase 1, Sprint 1.1)
 * - true: Use local job-service handler (fans out to candidate-core + matching-scoring)
 * - false: Proxy to monolith (safe fallback, or return basic job without ranking)
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(req.params.id);
    const companyId = parseInt((req as any).user?.company_id as string);

    if (!jobId || jobId <= 0 || !companyId || companyId <= 0) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    // Feature flag: JOB_DETAIL_CUTOVER_ENABLED
    const useLocalHandler = process.env.JOB_DETAIL_CUTOVER_ENABLED === 'true';

    if (useLocalHandler) {
      // Use local handler (job-service + candidate-core + matching-scoring)
      logger.debug({ jobId, companyId }, 'Using local job-service handler for /api/jobs/:id');
      const jobDetail = await getJobDetail(jobId, companyId);

      if (!jobDetail) {
        return res.status(404).json({ error: 'Job not found' });
      }

      return res.json(jobDetail);
    } else {
      // Fallback: Return basic job without ranking (safe)
      logger.debug({ jobId, companyId }, 'Using basic fallback for /api/jobs/:id');
      const result = await db.query(
        `
        SELECT * FROM jobs
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
        `,
        [jobId, companyId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Return job with empty matched_candidates (no ranking service available)
      return res.json({
        ...result.rows[0],
        matched_candidates: [],
      });
    }
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'GET /api/jobs/:id failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
