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
    const jobs = await db.getJobs();
    const swipes = await db.getSwipes();
    const candidates = await db.getCandidates();
  
    const enrichedJobs = jobs.map(j => {
      const jobSwipes = swipes.filter(s => s.job_id === j.id);
      return {
        ...j,
        total_candidates: candidates.length,
        reviewed: jobSwipes.length,
        accepted: jobSwipes.filter(s => s.action === 1).length
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
        company_id: 1,
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
    const id = parseInt(req.params.id);
    const jobs = await db.getJobs();
    const job = jobs.find(j => j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
  
    const candidates = await db.getCandidates();
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
    const id = parseInt(req.params.id);
    res.json({ id, ...req.body });
});
  
router.delete('/jobs/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
  
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }
  
      console.log(`🗑️ Deleting job ID: ${id}`);
  
      const deleted = await db.deleteJob(id);
  
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
