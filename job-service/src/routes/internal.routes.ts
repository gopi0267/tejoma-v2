/**
 * Internal API for Job Service. No auth, no gateway routing yet - same "built and validated, ready
 * for a future caller" status Role Intelligence Service (Batch 29) started at. job.routes.ts's
 * real `/api/jobs` surface fuses job CRUD with the live-scoring engine (rankCandidatesForJob) in
 * the same request - routing that whole contract here would require the scoring engine itself to
 * be reachable from this service too, which is out of scope for this batch. These endpoints serve
 * plain job data only, real and complete, for whichever future caller (e.g. candidate-facing job
 * browsing, which only ever reads) needs it without the scoring fusion.
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/jobs', async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const jobs = await db.getJobs(companyId);
  res.json({ jobs });
});

// Remaining-monolith migration, Step 6 - matching-decision-service's GET /api/swipes/history real
// cutover needs a bounded set of jobs by id for title hydration.
router.get('/jobs/by-ids', async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: 'companyId is required' });
  const ids = typeof req.query.ids === 'string' && req.query.ids.length > 0
    ? req.query.ids.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
    : [];
  const jobs = await db.getJobsByIds(ids, companyId);
  res.json({ jobs });
});

// Registered BEFORE the '/jobs/:id' param route below, deliberately - Express matches routes in
// registration order, and a param route matches ANY literal segment including "all", so with the
// opposite ordering a request to /jobs/all was being swallowed by /jobs/:id (id="all", fails
// Number.isFinite, always 400 "a valid id and companyId are required"). Same ordering-based
// collision this file's own by-ids route above already avoids by being listed first. Confirmed
// live: this bug made /internal/jobs/all completely unreachable, which is why
// candidate-service's job-browsing endpoints (added to use exactly this route) got nothing back.
router.get('/jobs/all', async (_req, res) => {
  try {
    // jobs has no deleted_at column (verified against the live schema - this table has no
    // soft-delete column at all) and getJobs' own "open only" convention above filters on
    // status = 'open', not a deleted_at check - matched here for consistency. The original
    // `WHERE deleted_at IS NULL` referenced a column that has never existed on this table, so
    // every call to this endpoint raised 'column "deleted_at" does not exist' (500).
    const result = await db.query(`
      SELECT id, company_id, title, description, location, required_skills, experience_years, salary_min, salary_max, status
      FROM jobs
      WHERE status = 'open'
      ORDER BY created_at DESC
    `);
    const jobs = result.rows.map((row: any) => ({
      id: row.id,
      company_id: row.company_id,
      title: row.title,
      description: row.description || '',
      location: row.location,
      required_skills: Array.isArray(row.required_skills) ? row.required_skills : (row.required_skills ? JSON.parse(row.required_skills) : []),
      experience_years: row.experience_years || 0,
      salary_min: row.salary_min || 0,
      salary_max: row.salary_max || 0,
      status: row.status,
    }));
    res.json({ jobs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const companyId = Number(req.query.companyId);
  if (!Number.isFinite(id) || !Number.isFinite(companyId)) {
    return res.status(400).json({ error: 'a valid id and companyId are required' });
  }
  const job = await db.getJobById(id, companyId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job });
});

export default router;
