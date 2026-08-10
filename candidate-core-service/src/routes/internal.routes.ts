/**
 * Internal API for Candidate Core Service
 *
 * Serves internal-only endpoints used by other services:
 * - GET /candidates/count - Candidate count for company
 * - GET /candidates/by-ids - Get candidate details by list of IDs
 */

import { Router } from 'express';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();

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

    // Create parameterized query: $1, $2, $3... for each ID
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const result = await db.query(
      `
      SELECT
        id,
        company_id,
        email,
        phone,
        first_name,
        last_name,
        skills,
        experience_years,
        education,
        created_at,
        updated_at
      FROM candidates
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY id
      `,
      ids
    );

    res.json({ candidates: result.rows });
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
        first_name,
        last_name,
        skills,
        experience_years,
        education,
        created_at,
        updated_at
      FROM candidates
      WHERE candidate_account_id = $1 AND deleted_at IS NULL
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
        first_name,
        last_name,
        skills,
        experience_years,
        location,
        resume_text,
        created_at,
        updated_at
      FROM candidates
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [companyId]
    );

    // Format candidates for scoring
    const candidates = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      skills: Array.isArray(row.skills) ? row.skills : (row.skills ? JSON.parse(row.skills) : []),
      experience_years: row.experience_years || 0,
      location: row.location,
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
        id, company_id, name, email, skills, years_of_experience, current_location, resume_text
      FROM candidates
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      `
    );
    const candidates = result.rows.map((row) => ({
      id: row.id,
      company_id: row.company_id,
      name: row.name,
      email: row.email,
      skills: Array.isArray(row.skills) ? row.skills : (row.skills ? JSON.parse(row.skills) : []),
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
