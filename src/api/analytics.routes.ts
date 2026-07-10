import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
// Recruiters see their own dashboard/analytics; admins see everything. Not admin-only,
// since Dashboard.tsx/Analytics.tsx/JobManagement.tsx are used by regular recruiters today.
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/analytics/dashboard', async (req, res) => {
    try {
      const swipes = await db.getSwipes();
      const candidates = await db.getCandidates();
      const jobs = await db.getJobs();
  
      const total_reviewed = swipes.length;
      const matches_made = swipes.filter(s => s.action === 1).length;
      const avg_score = total_reviewed > 0 
        ? Number((swipes.reduce((acc, s) => acc + s.match_score, 0) / total_reviewed).toFixed(1)) 
        : 0;
      
      const acceptance_rate = total_reviewed > 0 
        ? Number(((matches_made / total_reviewed) * 100).toFixed(1)) 
        : 0;
  
      const dateMap: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dateMap[dateStr] = 0;
      }
  
      swipes.forEach(s => {
        const dateStr = typeof s.timestamp === 'string' 
          ? s.timestamp.split('T')[0] 
          : new Date(s.timestamp).toISOString().split('T')[0];
        if (dateMap[dateStr] !== undefined) {
          dateMap[dateStr]++;
        }
      });
  
      const trends = Object.keys(dateMap).map(date => ({
        date,
        swipes: dateMap[date]
      }));
  
      const recentActivities = swipes.slice(-5).map(s => {
        const candidate = candidates.find(c => c.id === s.candidate_id);
        const job = jobs.find(j => j.id === s.job_id);
        return {
          id: s.id,
          recruiterName: 'Razi M',
          candidateName: candidate ? candidate.name : 'Candidate',
          jobTitle: job ? job.title : 'Job',
          action: s.action === 1 ? 'accept' : s.action === 0.5 ? 'save' : 'reject',
          timestamp: s.timestamp
        };
      }).reverse();
  
      const todayStr = new Date().toISOString().split('T')[0];
      const totalSwipesToday = swipes.filter(s => {
    const tsStr = typeof s.timestamp === 'string' ? s.timestamp : new Date(s.timestamp).toISOString();
    return tsStr.startsWith(todayStr);
  }).length;
  
      const openJobs = jobs.filter(j => j.status === 'open');
      let pendingCandidates = 0;
      if (openJobs.length > 0) {
        openJobs.forEach(job => {
          const swipedCandidateIds = new Set(swipes.filter(s => s.job_id === job.id).map(s => s.candidate_id));
          pendingCandidates += candidates.filter(c => !swipedCandidateIds.has(c.id)).length;
        });
      } else {
        pendingCandidates = candidates.length;
      }
  
      res.json({
        total_reviewed,
        matches_made,
        avg_score,
        acceptance_rate,
        trends,
        recent_activity: recentActivities,
        totalSwipesToday,
        acceptanceRate: acceptance_rate,
        totalCandidatesReviewed: total_reviewed,
        pendingCandidates,
        swipesTrend: trends,
        recentActivity: recentActivities
      });
    } catch (error: any) {
      console.error('Dashboard error:', error);
      res.status(500).json({ error: 'Failed to load dashboard: ' + error.message });
    }
});
  
router.get('/analytics/job/:job_id', async (req, res) => {
    const job_id = parseInt(req.params.job_id);
    const swipes = (await db.getSwipes()).filter(s => s.job_id === job_id);
    const candidates = await db.getCandidates();
  
    const total_reviewed = swipes.length;
    const accepted = swipes.filter(s => s.action === 1).length;
    const acceptance_rate = total_reviewed > 0 ? Number(((accepted / total_reviewed) * 100).toFixed(1)) : 0;
  
    const skillCount: Record<string, number> = {};
    swipes.filter(s => s.action === 1).forEach(s => {
      const candidate = candidates.find(c => c.id === s.candidate_id);
      if (candidate) {
        const skillsArray = typeof candidate.skills === 'string'
          ? candidate.skills.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null')
          : (Array.isArray(candidate.skills) ? candidate.skills : []);
        skillsArray.forEach(skill => {
          skillCount[skill] = (skillCount[skill] || 0) + 1;
        });
      }
    });
  
    const skillDistribution = Object.keys(skillCount).map(name => ({
      name,
      value: skillCount[name]
    })).sort((a, b) => b.value - a.value).slice(0, 5);
  
    res.json({ total_reviewed, acceptance_rate, skillDistribution });
});
  
router.get('/analytics/recruiter/:recruiter_id', async (req, res) => {
    const r_id = parseInt(req.params.recruiter_id);
    const swipes = (await db.getSwipes()).filter(s => s.recruiter_id === r_id);
  
    const swipesCount = swipes.length;
    const accepted = swipes.filter(s => s.action === 1).length;
    const acceptanceRate = swipesCount > 0 ? Number(((accepted / swipesCount) * 100).toFixed(1)) : 0;
    const averageMatchScore = swipesCount > 0 ? Number((swipes.reduce((acc, s) => acc + s.match_score, 0) / swipesCount).toFixed(1)) : 0;
  
    res.json({
      id: r_id,
      name: 'Razi M',
      email: 'recruiter@tejoma.com',
      swipesCount,
      acceptanceRate,
      averageMatchScore,
      avgTimeSpentSeconds: 6.4
    });
});
  
router.get('/analytics/skills', async (req, res) => {
    const candidates = await db.getCandidates();
    const skillCount: Record<string, number> = {};
  
    candidates.forEach(c => {
      const skillsArray = typeof c.skills === 'string'
        ? c.skills.split(',').map(s => s.trim()).filter(s => s && s.toLowerCase() !== 'null')
        : (Array.isArray(c.skills) ? c.skills : []);
      skillsArray.forEach(skill => {
        skillCount[skill] = (skillCount[skill] || 0) + 1;
      });
    });
  
    const sortedSkills = Object.keys(skillCount).map(skill => ({
      skill,
      count: skillCount[skill]
    })).sort((a, b) => b.count - a.count).slice(0, 8);
  
    res.json(sortedSkills);
});

export default router;
