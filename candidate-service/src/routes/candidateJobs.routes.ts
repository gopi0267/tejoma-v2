/**
 * Candidate Jobs - lists open jobs and provides job details for candidates.
 *
 * job-service's `/api/jobs` (staff-only, requireRole('recruiter','admin')) and its `/internal/`
 * companyId-scoped endpoints all serve the recruiter side - a recruiter's own company's postings.
 * Candidate job browsing is the opposite shape: one candidate reading across every company's open
 * postings. job-service already has exactly the endpoint for that -
 * GET /internal/jobs/all - added by job-service itself with the header comment "for whichever
 * future caller (e.g. candidate-facing job browsing, which only ever reads) needs it". This
 * router is that caller. Search/filter/sort/pagination are applied here rather than on
 * job-service, since /internal/jobs/all is intentionally a plain unscoped dump - no new
 * job-service endpoint was added.
 *
 * Company name/logo come from tenant-directory-service via jobHydration.ts, since neither this
 * service's database nor job-service's has a companies table.
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { getAllOpenJobs, type Job } from '../services/jobServiceClient.js';
import { hydrateJobsForRows, type HydratedJob } from '../services/jobHydration.js';

const router = Router();
router.use(requireCandidateAuth);

function matchesFilters(job: Job, filters: { search?: string; skill?: string; location?: string; company?: string; companyNamesById: Map<number, string> }): boolean {
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = `${job.title} ${job.description ?? ''}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.skill) {
    const q = filters.skill.toLowerCase();
    const skills: string[] = Array.isArray(job.required_skills)
      ? (job.required_skills as unknown as string[])
      : typeof job.required_skills === 'string'
        ? [job.required_skills]
        : [];
    if (!skills.some((s) => s.toLowerCase().includes(q))) return false;
  }
  if (filters.location) {
    const q = filters.location.toLowerCase();
    if (!String(job.location ?? '').toLowerCase().includes(q)) return false;
  }
  if (filters.company) {
    const q = filters.company.toLowerCase();
    const name = filters.companyNamesById.get(job.company_id) ?? '';
    if (!name.toLowerCase().includes(q)) return false;
  }
  return true;
}

// ==================== BROWSE / SEARCH OPEN JOBS ====================
router.get('/candidate-jobs', async (req, res) => {
  try {
    const { search, skill, location, company } = req.query;
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));

    const allJobs = await getAllOpenJobs();

    // Hydrated once up front (all companies referenced by the open-jobs set) so the company
    // filter and the response's company_name both use the same lookup.
    const hydrated = await hydrateJobsForRows(allJobs.map((j) => ({ job_id: j.id, company_id: j.company_id })));
    const companyNamesById = new Map<number, string>();
    for (const job of hydrated.values()) {
      if (job.company_name) companyNamesById.set(job.company_id, job.company_name);
    }

    const filtered = allJobs.filter((job) =>
      matchesFilters(job, {
        search: typeof search === 'string' ? search : undefined,
        skill: typeof skill === 'string' ? skill : undefined,
        location: typeof location === 'string' ? location : undefined,
        company: typeof company === 'string' ? company : undefined,
        companyNamesById,
      })
    );

    const total = filtered.length;
    const pageJobs = filtered.slice(page * pageSize, page * pageSize + pageSize);
    const jobs: HydratedJob[] = pageJobs.map((j) => hydrated.get(j.id) ?? j);

    res.json({ jobs, total, page, pageSize });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load jobs');
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// ==================== JOB DETAIL ====================
router.get('/candidate-jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }

    const allJobs = await getAllOpenJobs();
    const job = allJobs.find((j) => j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const hydrated = await hydrateJobsForRows([{ job_id: job.id, company_id: job.company_id }]);
    res.json(hydrated.get(job.id) ?? job);
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load job');
    res.status(500).json({ error: 'Failed to load job' });
  }
});

// ==================== MATCH EXPLANATION ====================
router.get('/candidate-jobs/:id/explanation', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    // No monolith or service equivalent exists for per-candidate match-score explanation text
    // (the monolith's own version required matching-decision-service's LLM-based explanation
    // generation, a separate, larger scope). Left as an honest placeholder rather than invented.
    res.json({
      jobId: id,
      explanation: 'Match explanation coming soon',
      score: null,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Failed to load match explanation');
    res.status(500).json({ error: 'Failed to load explanation' });
  }
});

export default router;
