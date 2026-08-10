import { Router, Request, Response } from 'express';
import db from '../../db';

export const swipesInternalRoutes = Router();

// GET /internal/swipes/counts-by-job?companyId=:companyId
// Returns swipe counts grouped by job_id
swipesInternalRoutes.get('/counts-by-job', async (req: Request, res: Response) => {
  const companyId = req.query.companyId as string;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const query = `
      SELECT
        job_id,
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN action = 1 THEN 1 ELSE 0 END), 0) as accepted,
        COALESCE(SUM(CASE WHEN action = 0 THEN 1 ELSE 0 END), 0) as rejected,
        COALESCE(SUM(CASE WHEN action = 0.5 THEN 1 ELSE 0 END), 0) as pending
      FROM swipes
      WHERE company_id = $1 AND deleted_at IS NULL
      GROUP BY job_id
    `;

    const result = await db.query(query, [companyId]);

    const counts: { [key: string]: any } = {};
    for (const row of result.rows) {
      counts[row.job_id] = {
        total: row.total,
        accepted: row.accepted,
        rejected: row.rejected,
        pending: row.pending,
      };
    }

    res.json(counts);
  } catch (error) {
    console.error('Error getting swipe counts by job:', error);
    res.status(500).json({ error: 'Failed to get swipe counts' });
  }
});

// GET /internal/swipes/latest-per-pair?companyId=:companyId&action=:action
// Returns latest swipe per (candidate_id, job_id) pair
swipesInternalRoutes.get('/latest-per-pair', async (req: Request, res: Response) => {
  const companyId = req.query.companyId as string;
  const action = req.query.action; // Optional filter

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    let query = `
      SELECT DISTINCT ON (candidate_id, job_id)
        id, candidate_id, job_id, company_id, recruiter_id,
        action, match_score, decision_notes, created_at, updated_at
      FROM swipes
      WHERE company_id = $1 AND deleted_at IS NULL
    `;

    const params: any[] = [companyId];

    if (action !== undefined && action !== null) {
      query += ` AND action = $${params.length + 1}`;
      params.push(parseFloat(action as string));
    }

    query += ` ORDER BY candidate_id, job_id, created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting latest swipes per pair:', error);
    res.status(500).json({ error: 'Failed to get latest swipes' });
  }
});
