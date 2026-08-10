/**
 * Internal API for Candidate Service
 *
 * Serves internal-only endpoints used by other services:
 * - GET /internal/matches/by-company - Mutual matches for recruiting-service
 */

import { Router } from 'express';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /internal/matches/by-company?companyId=123&jobId=456
 *
 * Get mutual matches for a company (and optionally filtered by job)
 * Used by: recruiting-service to fetch recruiter-matches
 *
 * Returns matches with minimal data (IDs + timestamps for joining)
 * Recruiting-service will enrich with job/candidate/notification data
 */
router.get('/matches/by-company', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    const jobId = req.query.jobId ? Number(req.query.jobId) : undefined;

    if (!Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // Get matches from local mirror table
    const query = `
      SELECT
        id,
        company_id,
        candidate_id,
        job_id,
        matched_at,
        created_at,
        updated_at
      FROM mutual_matches
      WHERE company_id = $1
      ${jobId ? 'AND job_id = $2' : ''}
      ORDER BY matched_at DESC
    `;

    const params = jobId ? [companyId, jobId] : [companyId];
    const result = await db.query(query, params);

    logger.debug(
      { companyId, jobId, matchCount: result.rows.length },
      'Fetched mutual matches for recruiting-service'
    );

    res.json({ matches: result.rows });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get matches by company');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
