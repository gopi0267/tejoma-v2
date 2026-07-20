import { Router } from 'express';
import { db } from '../db.js';
import { calculateMatchScoresBatch } from '../services.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { indexJobInBackground, removeJobFromIndex } from '../rag.service.js';
import { indexJobEmbeddingInBackground } from '../matching/embeddingIndex.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/jobs', async (req, res) => {
    const companyId = req.user!.company_id;
    // SQL-aggregated (one GROUP BY query for every job's counts, one COUNT for the candidate
    // pool size) instead of pulling the full swipes/candidates tables into Node and filtering
    // per job in JS - same production pattern as the Analytics Hub aggregation helpers.
    const [jobs, swipeCounts, totalCandidates] = await Promise.all([
      db.getJobs(companyId),
      db.getJobSwipeCounts(companyId),
      db.countCandidates(companyId),
    ]);

    const enrichedJobs = jobs.map(j => {
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

    res.json(enrichedJobs);
});
  
const toStringArray = (val: any): string[] => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

router.post('/jobs', async (req, res) => {
    try {
      const {
        title, description, required_skills, experience_years, location, salary_min, salary_max,
        // Optional JD-parser fields - all backward compatible, a manually-created job simply
        // omits them and they're stored as empty/null (see migration-job-description-fields.sql).
        optional_skills, min_experience, max_experience, experience_unit, remote_type, employment_type,
        industry, department, education, certifications, salary_currency, notice_period,
        number_of_openings, required_languages, responsibilities, tech_stack, keywords, job_summary,
        source_raw_text, parse_confidence,
      } = req.body;
      if (!title || !description || !required_skills) {
        return res.status(400).json({ error: 'Missing required job creation parameters' });
      }

      const newJob = await db.createJob({
        company_id: req.user!.company_id,
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

    const candidates = await db.getCandidates(companyId);
    // Batched: one round-trip to the ML ensemble for the whole candidate pool, not one per
    // candidate - matters once there are more than a handful of candidates to score.
    const scores = await calculateMatchScoresBatch(job, candidates, { skipGeminiSummary: true });
    const matchedCandidates = candidates.map((candidate, i) => ({
      candidate,
      match_score: scores[i].final_score,
      breakdown: scores[i].breakdown,
      summary: scores[i].summary,
    }));
    matchedCandidates.sort((a, b) => b.match_score - a.match_score);
  
    res.json({ job, matched_candidates: matchedCandidates });
});
  
router.put('/jobs/:id', async (req, res) => {
    try {
      const companyId = req.user!.company_id;
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const { title, description, required_skills, experience_years, location, salary_min, salary_max, status } = req.body;

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
      if (!updated) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Keep the RAG knowledge base and match-embedding in sync with the edited title/
      // description/skills - same background indexing already done on job creation, otherwise
      // the chatbot and semantic matching would silently keep using stale pre-edit content.
      indexJobInBackground(updated);
      indexJobEmbeddingInBackground(updated);

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
