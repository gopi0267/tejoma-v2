import { Router } from 'express';
import { db } from '../db.js';
import { calculateMatchScore } from '../services.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/matches/queue/:job_id', async (req, res) => {
    try {
      const job_id = parseInt(req.params.job_id);
      if (isNaN(job_id)) {
        return res.status(400).json({ error: 'Invalid Job ID parameter' });
      }
      
      const jobs = await db.getJobs();
      const job = jobs.find(j => j.id === job_id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
  
      const swipes = await db.getSwipes();
      const swipedCandidateIds = new Set(swipes.filter(s => s.job_id === job_id).map(s => s.candidate_id));
  
      const candidates = await db.getCandidates();
      const unswipedCandidates = candidates.filter(c => !swipedCandidateIds.has(c.id));
  
      if (unswipedCandidates.length === 0) {
        return res.json({ candidate: null, remaining: 0 });
      }
  
      // Calculate scores for all unreviewed candidates
      const scoredCandidates = [];
      for (const candidate of unswipedCandidates) {
        const scoreData = await calculateMatchScore(job, candidate, { skipGeminiSummary: true });
        scoredCandidates.push({
          candidate,
          match_score: scoreData.final_score,
          breakdown: scoreData.breakdown,
          summary: scoreData.summary
        });
      }
  
      // Sort by score descending
      scoredCandidates.sort((a, b) => b.match_score - a.match_score);
  
      // Get top candidate (skip the live Gemini call - it's not rendered in the UI and was blocking this request)
      const topCandidate = scoredCandidates[0];
      const topScoreData = await calculateMatchScore(job, topCandidate.candidate, { skipGeminiSummary: true });
  
      res.json({
        candidate: topCandidate.candidate,
        match_score: topScoreData.final_score,
        breakdown: topScoreData.breakdown,
        summary: topScoreData.summary,
        remaining: scoredCandidates.length
      });
  
    } catch (error: any) {
      console.error('Failed to load match queue candidate:', error);
      res.status(500).json({ error: 'Failed to load match queue: ' + error.message });
    }
});

router.post('/matches/score', async (req, res) => {
    try {
      const { job_id, candidate_id } = req.body;
      const parsedJobId = parseInt(job_id);
      const parsedCandId = parseInt(candidate_id);
      if (isNaN(parsedJobId) || isNaN(parsedCandId)) {
        return res.status(400).json({ error: 'Invalid Job ID or Candidate ID' });
      }
      const jobs = await db.getJobs();
      const candidates = await db.getCandidates();
      const job = jobs.find(j => j.id === parsedJobId);
      const candidate = candidates.find(c => c.id === parsedCandId);
  
      if (!job || !candidate) {
        return res.status(404).json({ error: 'Job or Candidate not found' });
      }
  
      const scoreData = await calculateMatchScore(job, candidate);
      res.json({
        feature_score: scoreData.feature_score,
        embedding_score: scoreData.embedding_score,
        ml_score: scoreData.ml_score,
        final_score: scoreData.final_score,
        breakdown: scoreData.breakdown,
        summary: scoreData.summary
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to compute match score: ' + error.message });
    }
});
  
router.post('/swipes', async (req, res) => {
    try {
      const { recruiter_id, job_id, candidate_id, action } = req.body;
      console.log('🔵 SWIPE RECEIVED:', { recruiter_id, job_id, candidate_id, action });
      
      if (!recruiter_id || !job_id || !candidate_id || action === undefined) {
        return res.status(400).json({ error: 'Missing required swipe payload properties' });
      }
  
      const jobs = await db.getJobs();
      const candidates = await db.getCandidates();
      const job = jobs.find(j => j.id === parseInt(job_id));
      const candidate = candidates.find(c => c.id === parseInt(candidate_id));
      
      console.log('🟢 FOUND:', { job: job?.title, candidate: candidate?.name });
      
      if (!job || !candidate) {
        return res.status(404).json({ error: 'Job or Candidate not found' });
      }
  
      const scoreData = await calculateMatchScore(job, candidate, { skipGeminiSummary: true });
  
      // ✅ SAVE SWIPE TO DATABASE
      console.log('💾 SAVING SWIPE:', { recruiter_id: parseInt(recruiter_id), candidate_id: parseInt(candidate_id), job_id: parseInt(job_id), action: Number(action), match_score: scoreData.final_score });
      
      const savedSwipe = await db.recordSwipe({
        recruiter_id: parseInt(recruiter_id),
        candidate_id: parseInt(candidate_id),
        job_id: parseInt(job_id),
        action: Number(action),
        match_score: scoreData.final_score,
        used_for_training: false
      });
      
      console.log('✅ SWIPE SAVED:', savedSwipe);
  
      broadcastEvent('swipe-completed', {
        recruiter_id: parseInt(recruiter_id),
        job_id: parseInt(job_id),
        candidate_id: parseInt(candidate_id),
        candidateName: candidate.name,
        action: Number(action) === 1 ? 'accept' : 'reject'
      });
  
      // GET NEXT CANDIDATE
      const swipes = await db.getSwipes();
      console.log('📊 TOTAL SWIPES IN DB:', swipes.length);
      
      const swipedCandidateIds = new Set(swipes.filter(s => s.job_id === job.id).map(s => s.candidate_id));
      const allCandidates = await db.getCandidates();
      const unswipedCandidates = allCandidates.filter(c => !swipedCandidateIds.has(c.id));
  
      console.log('👥 UNREVIEWED:', unswipedCandidates.length, 'of', allCandidates.length);
  
      let next_candidate = null;
      if (unswipedCandidates.length > 0) {
        const scoredPromises = unswipedCandidates.map(async (c) => {
          const sd = await calculateMatchScore(job, c, { skipGeminiSummary: true });
          return { candidate: c, score: sd.final_score, breakdown: sd.breakdown, summary: sd.summary };
        });
        const scored = await Promise.all(scoredPromises);
        scored.sort((a, b) => b.score - a.score);
        
        const topNextCandidate = scored[0].candidate;
        const topNextScoreData = await calculateMatchScore(job, topNextCandidate, { skipGeminiSummary: true });
        
        next_candidate = {
          candidate: topNextCandidate,
          match_score: topNextScoreData.final_score,
          breakdown: topNextScoreData.breakdown,
          summary: topNextScoreData.summary,
          remaining: scored.length
        };
      }
  
      res.status(201).json({
        success: true,
        match_score: scoreData.final_score,
        next_candidate
      });
    } catch (error: any) {
      console.error('❌ SWIPE ERROR:', error);
      res.status(500).json({ error: 'Failed to process swipe: ' + error.message });
    }
});
  
router.get('/swipes/history', async (req, res) => {
    const swipes = await db.getSwipes();
    const candidates = await db.getCandidates();
    const jobs = await db.getJobs();
  
    const history = swipes.map(s => {
      const candidate = candidates.find(c => c.id === s.candidate_id);
      const job = jobs.find(j => j.id === s.job_id);
      return {
        ...s,
        candidate_name: candidate ? candidate.name : 'Unknown Candidate',
        job_title: job ? job.title : 'Unknown Job'
      };
    });
  
    res.json(history.reverse());
});
  
router.get('/swipes/stats', async (req, res) => {
    const recruiter_id = parseInt(req.query.recruiter_id as string) || 1;
    const swipes = (await db.getSwipes()).filter(s => s.recruiter_id === recruiter_id);
  
    const total_swipes = swipes.length;
    const acceptances = swipes.filter(s => s.action === 1).length;
    const acceptance_rate = total_swipes > 0 ? Number(((acceptances / total_swipes) * 100).toFixed(1)) : 0;
    const average_score = total_swipes > 0 ? Number((swipes.reduce((acc, s) => acc + s.match_score, 0) / total_swipes).toFixed(1)) : 0;
  
    res.json({ total_swipes, acceptance_rate, average_score });
});

export default router;
