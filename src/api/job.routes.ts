import { Router } from 'express';
import { db } from '../db.js';
import { calculateMatchScore } from '../services.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

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
  
router.post('/jobs', async (req, res) => {
    try {
      const { title, description, required_skills, experience_years, location, salary_min, salary_max } = req.body;
      if (!title || !description || !required_skills) {
        return res.status(400).json({ error: 'Missing required job creation parameters' });
      }
  
      const newJob = await db.createJob({
        company_id: 1,
        title,
        description,
        required_skills: Array.isArray(required_skills) ? required_skills : required_skills.split(',').map((s: string) => s.trim()),
        experience_years: experience_years || 0,
        location: location || 'Remote',
        salary_min: salary_min || 0,
        salary_max: salary_max || 0,
        status: 'open'
      });
  
      broadcastEvent('job-created', { job_id: newJob?.id, title });
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
    const scoresPromises = candidates.map(async (candidate) => {
      const scoreData = await calculateMatchScore(job, candidate, { skipGeminiSummary: true });
      return {
        candidate,
        match_score: scoreData.final_score,
        breakdown: scoreData.breakdown,
        summary: scoreData.summary
      };
    });
  
    const matchedCandidates = await Promise.all(scoresPromises);
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
  
      res.status(200).json({ success: true, message: 'Job deleted successfully' });
    } catch (error: any) {
      console.error('❌ Delete job error:', error.message);
      res.status(500).json({ error: 'Failed to delete job: ' + error.message });
    }
});

export default router;
