import { Router } from 'express';
import { db } from '../db.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { indexJobInBackground, removeJobFromIndex } from '../rag.service.js';
import { indexJobEmbeddingInBackground } from '../matching/embeddingIndex.js';
import { rankCandidatesForJob } from '../matching/matchingApi.js';
// Tier 0 migration (Batch 27) - see src/skillDiscoveryServiceShadow.ts's header comment. Drop-in
// replacement for matching/unknownSkillDiscovery.ts's own export: same real local computation,
// plus an optional shadow comparison (SHADOW_SKILL_DISCOVERY_ENABLED, off by default).
import { discoverUnknownSkillsInBackground } from '../skillDiscoveryServiceShadow.js';
// Tier 0 migration (Batch 26) - see src/reasoningServiceShadow.ts's header comment. Drop-in
// replacement for matching/reasoning/computeReasoning.ts's own export: same real local
// computation, plus an optional shadow comparison (SHADOW_REASONING_ENABLED, off by default).
import { computeReasoningForJobInBackground } from '../reasoningServiceShadow.js';
import type { Job } from '../types.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery's "context" for a
// JD-sourced token, same composition embeddingIndex.ts's buildJobFacetTexts already uses for the
// "responsibilities" facet.
// Exported so Job Service's internal write/list proxy (src/api/job-internal.routes.ts, remaining-
// monolith migration Step 4) can reuse it without duplicating this small pure mapper.
export function jobDiscoveryContext(job: Job): string {
  return [...(job.responsibilities || []), job.job_summary].filter((t): t is string => Boolean(t && t.trim())).join('. ');
}

// Extracted so job-internal.routes.ts's list proxy can call the exact same aggregation - same
// reasoning as candidate.routes.ts's createCandidateWithSideEffects (Step 3a).
export async function getEnrichedJobsList(companyId: number) {
  // SQL-aggregated (one GROUP BY query for every job's counts, one COUNT for the candidate
  // pool size) instead of pulling the full swipes/candidates tables into Node and filtering
  // per job in JS - same production pattern as the Analytics Hub aggregation helpers.
  const [jobs, swipeCounts, totalCandidates] = await Promise.all([
    db.getJobs(companyId),
    db.getJobSwipeCounts(companyId),
    db.countCandidates(companyId),
  ]);

  return jobs.map(j => {
    const counts = swipeCounts.get(j.id) ?? { reviewed: 0, accepted: 0, rejected: 0, saved: 0 };
    return {
      ...j,
      total_candidates: totalCandidates,
      reviewed: counts.reviewed,
      accepted: counts.accepted,
      rejected: counts.rejected,
      saved: counts.saved,
      acceptance_rate: counts.reviewed > 0 ? Number(((counts.accepted / counts.reviewed) * 100).toFixed(1)) : 0,
    };
  });
}

router.get('/jobs', async (req, res) => {
    res.json(await getEnrichedJobsList(req.user!.company_id));
});

export const toStringArray = (val: any): string[] => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

// Extracted so job-internal.routes.ts's create proxy can reuse the exact same field mapping +
// create + 4 background triggers - same reasoning as candidate.routes.ts's
// createCandidateWithSideEffects (Step 3a). Returns null (not a validation error) when required
// fields are missing, matching the original route's own "Missing required job creation
// parameters" 400 - the caller decides how to surface that.
export async function createJobWithSideEffects(companyId: number, body: any): Promise<Job | null | 'invalid'> {
  const {
    title, description, required_skills, experience_years, location, salary_min, salary_max,
    optional_skills, min_experience, max_experience, experience_unit, remote_type, employment_type,
    industry, department, education, certifications, salary_currency, notice_period,
    number_of_openings, required_languages, responsibilities, tech_stack, keywords, job_summary,
    source_raw_text, parse_confidence,
  } = body;
  if (!title || !description || !required_skills) {
    return 'invalid';
  }

  const newJob = await db.createJob({
    company_id: companyId,
    title,
    description,
    required_skills: toStringArray(required_skills),
    experience_years: experience_years || 0,
    location: location || 'Remote',
    salary_min: salary_min || 0,
    salary_max: salary_max || 0,
    status: 'open',
    optional_skills: toStringArray(optional_skills),
    min_experience: min_experience ?? null,
    max_experience: max_experience ?? null,
    experience_unit: experience_unit ?? null,
    remote_type: remote_type ?? null,
    employment_type: employment_type ?? null,
    industry: industry ?? null,
    department: department ?? null,
    education: toStringArray(education),
    certifications: toStringArray(certifications),
    salary_currency: salary_currency ?? null,
    notice_period: notice_period ?? null,
    number_of_openings: number_of_openings ?? null,
    required_languages: toStringArray(required_languages),
    responsibilities: toStringArray(responsibilities),
    tech_stack: tech_stack ?? {},
    keywords: toStringArray(keywords),
    job_summary: job_summary ?? null,
    source_raw_text: source_raw_text ?? null,
    parse_confidence: parse_confidence ?? {},
  });

  broadcastEvent('job-created', { job_id: newJob?.id, title });
  if (newJob) {
    indexJobInBackground(newJob);
    indexJobEmbeddingInBackground(newJob);
    discoverUnknownSkillsInBackground(newJob.required_skills, jobDiscoveryContext(newJob), 'jd');
    computeReasoningForJobInBackground(newJob.id, newJob.required_skills, newJob.optional_skills);
  }
  return newJob;
}

router.post('/jobs', async (req, res) => {
    try {
      const newJob = await createJobWithSideEffects(req.user!.company_id, req.body);
      if (newJob === 'invalid') {
        return res.status(400).json({ error: 'Missing required job creation parameters' });
      }
      res.status(201).json(newJob);
    } catch (error: any) {
      console.error('Failed to create job:', error);
      res.status(500).json({ error: 'Failed to create job: ' + error.message });
    }
});
  
router.get('/jobs/:id', async (req, res) => {
    const companyId = req.user!.company_id;
    const id = parseInt(req.params.id);
    const job = await db.getJobById(id, companyId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Enterprise AI Matching Architecture, Phase 0: structured pre-filter ahead of scoring
    // (db.getCandidatesForJobScoring - a bounded, recall-first prioritization, not a hard
    // exclusion filter; see its doc comment) + the Unified Matching API's 'full' tier, which is
    // the exact same calculateMatchScoresBatch pipeline this endpoint already called directly -
    // no scoring behavior change, only where the candidate pool is bounded and where the scoring
    // call itself lives.
    const candidates = await db.getCandidatesForJobScoring(companyId, job.required_skills);
    const ranked = await rankCandidatesForJob(job, candidates, {
      tier: 'full',
      skipGeminiSummary: true,
      persist: { companyId, source: 'job_detail' },
    });
    const matchedCandidates = ranked.map(({ candidate, match_score, score }) => ({
      candidate,
      match_score,
      breakdown: score!.breakdown,
      summary: score!.summary,
    }));

    res.json({ job, matched_candidates: matchedCandidates });
});
  
// Extracted so job-internal.routes.ts's update proxy can reuse the exact same field mapping +
// update + 4 background triggers - same reasoning as createJobWithSideEffects above.
export async function updateJobWithSideEffects(id: number, companyId: number, body: any): Promise<Job | null> {
  const { title, description, required_skills, experience_years, location, salary_min, salary_max, status } = body;

  const updated = await db.updateJob(id, companyId, {
    title,
    description,
    required_skills: required_skills !== undefined ? toStringArray(required_skills) : undefined,
    experience_years,
    location,
    salary_min,
    salary_max,
    status,
  });
  if (!updated) return null;

  // Keep the RAG knowledge base and match-embedding in sync with the edited title/
  // description/skills - same background indexing already done on job creation, otherwise
  // the chatbot and semantic matching would silently keep using stale pre-edit content.
  indexJobInBackground(updated);
  indexJobEmbeddingInBackground(updated);
  discoverUnknownSkillsInBackground(updated.required_skills, jobDiscoveryContext(updated), 'jd');
  computeReasoningForJobInBackground(updated.id, updated.required_skills, updated.optional_skills);

  return updated;
}

router.put('/jobs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const updated = await updateJobWithSideEffects(id, req.user!.company_id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(updated);
    } catch (error: any) {
      console.error('Failed to update job:', error);
      res.status(500).json({ error: 'Failed to update job: ' + error.message });
    }
});
  
router.delete('/jobs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
  
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }
  
      console.log(`🗑️ Deleting job ID: ${id}`);

      const deleted = await db.deleteJob(id, req.user!.company_id);
  
      if (!deleted) {
        return res.status(404).json({ error: 'Job not found or could not be deleted' });
      }

      removeJobFromIndex(id).catch((err) => console.error(`RAG unindex failed for job ${id}:`, err.message));
      res.status(200).json({ success: true, message: 'Job deleted successfully' });
    } catch (error: any) {
      console.error('❌ Delete job error:', error.message);
      res.status(500).json({ error: 'Failed to delete job: ' + error.message });
    }
});

export default router;
