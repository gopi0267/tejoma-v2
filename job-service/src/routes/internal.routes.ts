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

router.get('/jobs/all', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT id, company_id, title, description, location, required_skills, experience_years, salary_min, salary_max, status
      FROM jobs
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `);
    const jobs = result.rows.map((row) => ({
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

export default router;
