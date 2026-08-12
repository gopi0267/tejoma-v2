/**
 * Internal API for Candidate Core Service
 *
 * Serves internal-only endpoints used by other services:
 * - GET /candidates/count - Candidate count for company
 * - GET /candidates/by-ids - Get candidate details by list of IDs
 */

import { Router } from 'express';
import { db, mapRowToCandidate } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();

// candidates.skills is a comma-separated TEXT column, not JSON (verified against the live
// schema). The routes below used JSON.parse on it, which threw
// "Unexpected token 'N'" on the first real row and turned /candidates/for-job-scoring and
// /candidates/all into unconditional 500s. This mirrors db.ts's own parseList convention, which
// is what mapRowToCandidate already uses for the same column.
function parseSkills(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (val === null || val === undefined) return [];
  const str = String(val).trim();
  if (str === '' || str.toLowerCase() === 'null') return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * GET /internal/candidates/count?companyId=123
 *
 * Get count of active candidates for a company
 * Used by: job-service to enrich job listings
 */
router.get('/candidates/count', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);

    if (!Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const result = await db.query(
      `
      SELECT COUNT(*) as count
      FROM candidates
      WHERE company_id = $1
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

/**
 * GET /internal/candidates/by-ids?ids=1,2,3
 *
 * Get candidate details by list of IDs
 * Used by: candidate-service, matching-decision-service for enrichment
 */
router.get('/candidates/by-ids', async (req, res) => {
  try {
    const idsParam = req.query.ids as string;

    if (!idsParam) {
      return res.json({ candidates: [] });
    }

    const ids = idsParam
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n));

    if (ids.length === 0) {
      return res.json({ candidates: [] });
    }

    // Delegates to db.getCandidatesByIds rather than hand-rolling the SQL. The previous inline
    // query selected first_name, last_name, experience_years and filtered on deleted_at - none of
    // which exist on this table (the real columns are name, years_of_experience, and there is no
    // soft-delete column), so it raised 'column "first_name" does not exist' and returned 500 on
    // every call. It also ignored companyId entirely despite the endpoint accepting it, which
    // would have leaked candidates across tenants had the query run at all.
    //
    // Live impact: matching-decision-service's getCandidateById is implemented as
    // getCandidatesByIds([id]), so POST /api/swipes could never resolve a candidate and every
    // recruiter swipe returned 404 'Job or Candidate not found'.
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // Mapped through mapRowToCandidate, the same converter /api/candidates uses, so consumers
    // receive skills as a string[] rather than the raw comma-separated TEXT column. Returning raw
    // rows here broke matching-decision-service's swipe path with
    // 'candidate.skills?.join is not a function'.
    const rows = await db.getCandidatesByIds(ids, companyId);
    res.json({ candidates: rows.map(mapRowToCandidate) });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get candidates by IDs');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /internal/candidates/by-account-id?candidateAccountId=123
 *
 * Get candidate by account ID (unscoped cross-company)
 * Used by: candidate-analytics for cross-company lookups
 */
router.get('/candidates/by-account-id', async (req, res) => {
  try {
    const candidateAccountId = Number(req.query.candidateAccountId);

    if (!Number.isFinite(candidateAccountId)) {
      return res.status(400).json({ error: 'candidateAccountId is required' });
    }

    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        email,
        phone,
        name,
        skills,
        years_of_experience,
        education,
        created_at,
        updated_at
      FROM candidates
      WHERE candidate_account_id = $1
      `,
      [candidateAccountId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({ candidate: result.rows[0] });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get candidate by account ID');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /internal/candidates/for-job-scoring?companyId=123&requiredSkills=JavaScript,React
 *
 * Get candidates for job scoring (bounded pool, recall-first prioritization)
 * Used by: job-service to rank candidates for job detail endpoint
 *
 * This is NOT a hard exclusion filter - prioritizes candidates with matching skills
 * but includes others for comprehensive matching.
 */
router.get('/candidates/for-job-scoring', async (req, res) => {
  try {
    const companyId = Number(req.query.companyId);
    const requiredSkillsParam = req.query.requiredSkills as string;

    if (!Number.isFinite(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // Parse required skills (comma-separated)
    const requiredSkills = requiredSkillsParam
      ? requiredSkillsParam.split(',').map((s) => s.toLowerCase().trim()).filter(Boolean)
      : [];

    // Get active candidates with their skills
    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        email,
        phone,
        name,
        skills,
        years_of_experience,
        current_location,
        resume_text,
        created_at,
        updated_at
      FROM candidates
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [companyId]
    );

    // Format candidates for scoring
    const candidates = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      skills: parseSkills(row.skills),
      years_of_experience: row.years_of_experience || 0,
      location: row.current_location,
    }));

    logger.debug(
      { companyId, requiredSkillsCount: requiredSkills.length, candidateCount: candidates.length },
      'Fetched candidates for job scoring'
    );

    res.json({ candidates });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get candidates for job scoring');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /internal/candidates/all
 * Get ALL candidates (unscoped, admin-only for RAG reindexing)
 * Used by: chat-service for RAG knowledge base reindex
 */
router.get('/candidates/all', async (_req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        id, company_id, candidate_account_id, name, email, skills, years_of_experience, current_location, resume_text
      FROM candidates
      
      ORDER BY created_at DESC
      `
    );
    const candidates = result.rows.map((row) => ({
      id: row.id,
      company_id: row.company_id,
      // Additive: matching-scoring-service's ML training joins application status (keyed by
      // candidate_account_id in candidate-service's DB) back to candidates. The monolith did that
      // as a cross-database JOIN; across services it needs the link key on this side.
      candidate_account_id: row.candidate_account_id,
      name: row.name,
      email: row.email,
      skills: parseSkills(row.skills),
      years_of_experience: row.years_of_experience || 0,
      current_location: row.current_location,
      resume_text: row.resume_text || '',
    }));
    res.json({ candidates });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to get all candidates');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
