/**
 * Internal Endpoints: Matching Explainability
 *
 * Monolith internal API exposing career trajectory & reasoning conclusions
 * Used by: matching-decision-service for recruiter-review detail computation
 *
 * These tables are monolith-only (not mirrored anywhere).
 * They're populated synchronously when candidates are created/updated.
 * Matching-decision-service calls these endpoints to enrich match explanations.
 *
 * Pattern: Read-only, fire-and-forget, no caching
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger.js';
import { db } from '../../db.js';

const router = Router();

/**
 * GET /internal/career-trajectory?candidateId=123&companyId=456
 *
 * Get career trajectory for a candidate
 * Used to: Compute seniority level, infer experience trajectory
 *
 * Response: {
 *   candidateId: 123,
 *   positions: [...],
 *   trajectory: "junior" | "mid" | "senior" | "lead",
 *   yearsInField: 5
 * }
 */
router.get('/career-trajectory', async (req: Request, res: Response) => {
  try {
    const candidateId = parseInt(req.query.candidateId as string);
    const companyId = parseInt(req.query.companyId as string);

    if (!candidateId || !companyId) {
      return res.status(400).json({ error: 'candidateId and companyId are required' });
    }

    // Get career trajectory record
    const result = await db.query(
      `
      SELECT
        candidate_id,
        company_id,
        positions,
        trajectory,
        years_in_field,
        created_at,
        updated_at
      FROM career_trajectories
      WHERE candidate_id = $1 AND company_id = $2
      `,
      [candidateId, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Career trajectory not found' });
    }

    const row = result.rows[0];

    res.json({
      candidateId: row.candidate_id,
      companyId: row.company_id,
      positions: row.positions,
      trajectory: row.trajectory,
      yearsInField: row.years_in_field,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get career trajectory');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /internal/reasoning-conclusions?subjectType=candidate&subjectId=123
 *
 * Get reasoning conclusions for a candidate or job
 * Used to: Compute match concerns, reasoning narrative
 *
 * Response: {
 *   subjectType: "candidate",
 *   subjectId: 123,
 *   conclusions: [...],
 *   reasoning: "..."
 * }
 */
router.get('/reasoning-conclusions', async (req: Request, res: Response) => {
  try {
    const subjectType = req.query.subjectType as string;
    const subjectId = parseInt(req.query.subjectId as string);

    if (!subjectType || !subjectId) {
      return res.status(400).json({ error: 'subjectType and subjectId are required' });
    }

    if (!['candidate', 'job'].includes(subjectType)) {
      return res.status(400).json({ error: 'subjectType must be "candidate" or "job"' });
    }

    // Get reasoning conclusions record
    const result = await db.query(
      `
      SELECT
        subject_type,
        subject_id,
        conclusions,
        reasoning,
        confidence,
        created_at,
        updated_at
      FROM reasoning_conclusions
      WHERE subject_type = $1 AND subject_id = $2
      `,
      [subjectType, subjectId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reasoning conclusions not found' });
    }

    const row = result.rows[0];

    res.json({
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      conclusions: row.conclusions,
      reasoning: row.reasoning,
      confidence: parseFloat(row.confidence),
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get reasoning conclusions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
