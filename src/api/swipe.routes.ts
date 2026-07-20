import { Router } from 'express';
import { db } from '../db.js';
import { calculateMatchScore, calculateMatchScoresBatch, trainModelOnStartup } from '../services.js';
import { logger } from '../utils/logger.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/matches/queue/:job_id', async (req, res) => {
    try {
      const companyId = req.user!.company_id;
      const job_id = parseInt(req.params.job_id);
      if (isNaN(job_id)) {
        return res.status(400).json({ error: 'Invalid Job ID parameter' });
      }

      const job = await db.getJobById(job_id, companyId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Shortlist-only queue: only candidates Selected in Job Positions (or Saved from within
      // this deck) whose latest decision for this job is still "Saved" (action=0.5) - i.e. not
      // yet finalized to Accepted/Rejected. See db.getShortlistedCandidateIds.
      const shortlistedIds = await db.getShortlistedCandidateIds(job_id, companyId);

      const candidates = await db.getCandidates(companyId);
      const queueCandidates = candidates.filter(c => shortlistedIds.has(c.id));

      if (queueCandidates.length === 0) {
        return res.json({ candidate: null, remaining: 0 });
      }

      // Batched: one round-trip to the ML ensemble for every shortlisted candidate, not one per
      // candidate.
      const scores = await calculateMatchScoresBatch(job, queueCandidates, { skipGeminiSummary: true });
      const scoredCandidates = queueCandidates.map((candidate, i) => ({
        candidate,
        match_score: scores[i].final_score,
        breakdown: scores[i].breakdown,
        summary: scores[i].summary,
      }));

      // Sort by score descending
      scoredCandidates.sort((a, b) => b.match_score - a.match_score);

      const topCandidate = scoredCandidates[0];
      res.json({
        candidate: topCandidate.candidate,
        match_score: topCandidate.match_score,
        breakdown: topCandidate.breakdown,
        summary: topCandidate.summary,
        remaining: scoredCandidates.length
      });
  
    } catch (error: any) {
      console.error('Failed to load match queue candidate:', error);
      res.status(500).json({ error: 'Failed to load match queue: ' + error.message });
    }
});

router.post('/matches/score', async (req, res) => {
    try {
      const companyId = req.user!.company_id;
      const { job_id, candidate_id } = req.body;
      const parsedJobId = parseInt(job_id);
      const parsedCandId = parseInt(candidate_id);
      if (isNaN(parsedJobId) || isNaN(parsedCandId)) {
        return res.status(400).json({ error: 'Invalid Job ID or Candidate ID' });
      }
      const job = await db.getJobById(parsedJobId, companyId);
      const candidate = await db.getCandidateById(parsedCandId, companyId);

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
      const companyId = req.user!.company_id;
      // recruiter_id is derived from the authenticated session, never trusted from the client -
      // otherwise any signed-in user could record swipes attributed to a different recruiter.
      const recruiter_id = req.user!.user_id;
      const { job_id, candidate_id, action, decision_time_seconds } = req.body;
      console.log('🔵 SWIPE RECEIVED:', { recruiter_id, job_id, candidate_id, action, decision_time_seconds });

      if (!job_id || !candidate_id || action === undefined) {
        return res.status(400).json({ error: 'Missing required swipe payload properties' });
      }

      const job = await db.getJobById(parseInt(job_id), companyId);
      const candidate = await db.getCandidateById(parseInt(candidate_id), companyId);

      console.log('🟢 FOUND:', { job: job?.title, candidate: candidate?.name });

      if (!job || !candidate) {
        return res.status(404).json({ error: 'Job or Candidate not found' });
      }

      const scoreData = await calculateMatchScore(job, candidate, { skipGeminiSummary: true });

      // ✅ SAVE SWIPE TO DATABASE
      console.log('💾 SAVING SWIPE:', { recruiter_id, candidate_id: parseInt(candidate_id), job_id: parseInt(job_id), action: Number(action), match_score: scoreData.final_score });

      const savedSwipe = await db.recordSwipe({
        company_id: companyId,
        recruiter_id,
        candidate_id: parseInt(candidate_id),
        job_id: parseInt(job_id),
        action: Number(action),
        match_score: scoreData.final_score,
        used_for_training: false,
        // Captured at decision time (see migration-recruiter-review.sql) so Recruiter Review's
        // score breakdown doesn't drift as the ML ensemble retrains after this swipe.
        breakdown: scoreData.breakdown,
        // Optional client-measured seconds-on-card (see migration-analytics-decision-timing.sql);
        // undefined/invalid values simply store NULL, never blocking the swipe itself.
        decision_time_seconds: typeof decision_time_seconds === 'number' && isFinite(decision_time_seconds) ? decision_time_seconds : null,
      });

      // db.recordSwipe catches its own DB errors internally and returns null on failure rather
      // than throwing (e.g. the swipes.action column once silently rejected 0.5 - see
      // migration-swipes-action-numeric.sql) - without this check the route fell through to a
      // 201 success response regardless, which is exactly how that bug went undetected.
      if (!savedSwipe) {
        console.error('❌ SWIPE SAVE FAILED: recordSwipe returned null', { recruiter_id, job_id, candidate_id, action });
        return res.status(500).json({ error: 'Failed to save swipe decision. Please try again.' });
      }

      console.log('✅ SWIPE SAVED:', savedSwipe);

      broadcastEvent('swipe-completed', {
        recruiter_id,
        job_id: parseInt(job_id),
        candidate_id: parseInt(candidate_id),
        candidateName: candidate.name,
        action: Number(action) === 1 ? 'accept' : 'reject'
      });

      // Retrain the matching ensemble in the background - every swipe is a fresh labeled
      // example, and training on the small dataset this app currently has is cheap. Never
      // blocks the swipe response; a slow/failed retrain must not break the swipe UX.
      // Training stays pooled across all companies (it only ever sees numeric feature vectors,
      // never PII), even though the swipe/candidate/job data itself is tenant-scoped.
      trainModelOnStartup().catch((err) => logger.warn({ err: err.message }, 'Background retrain after swipe failed'));

      // GET NEXT CANDIDATE - next still-shortlisted-and-pending candidate for this job (the
      // swipe just recorded above already moved `candidate` off the shortlist if it was a final
      // Accept/Reject, since getShortlistedCandidateIds only reads the latest row per pair).
      const shortlistedIds = await db.getShortlistedCandidateIds(job.id, companyId);
      const allCandidates = await db.getCandidates(companyId);
      const queueCandidates = allCandidates.filter(c => shortlistedIds.has(c.id));

      console.log('👥 SHORTLISTED PENDING:', queueCandidates.length, 'of', allCandidates.length);

      let next_candidate = null;
      if (queueCandidates.length > 0) {
        // Batched: one round-trip to the ML ensemble for every shortlisted candidate.
        const scores = await calculateMatchScoresBatch(job, queueCandidates, { skipGeminiSummary: true });
        const scored = queueCandidates.map((c, i) => ({ candidate: c, score: scores[i].final_score, breakdown: scores[i].breakdown, summary: scores[i].summary }));
        scored.sort((a, b) => b.score - a.score);

        const top = scored[0];
        next_candidate = {
          candidate: top.candidate,
          match_score: top.score,
          breakdown: top.breakdown,
          summary: top.summary,
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
    const companyId = req.user!.company_id;
    const swipes = await db.getSwipes(companyId);
    const candidates = await db.getCandidates(companyId);
    const jobs = await db.getJobs(companyId);

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
    const companyId = req.user!.company_id;
    // Defaults to the caller's own stats rather than a hardcoded id; an explicit recruiter_id
    // (e.g. to view a teammate's stats) is still allowed but scoped to the caller's own company.
    const recruiter_id = parseInt(req.query.recruiter_id as string) || req.user!.user_id;
    const swipes = (await db.getSwipes(companyId)).filter(s => s.recruiter_id === recruiter_id);

    const total_swipes = swipes.length;
    const acceptances = swipes.filter(s => s.action === 1).length;
    const acceptance_rate = total_swipes > 0 ? Number(((acceptances / total_swipes) * 100).toFixed(1)) : 0;
    const average_score = total_swipes > 0 ? Number((swipes.reduce((acc, s) => acc + s.match_score, 0) / total_swipes).toFixed(1)) : 0;
  
    res.json({ total_swipes, acceptance_rate, average_score });
});

export default router;
