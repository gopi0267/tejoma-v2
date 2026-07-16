import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
// Recruiters see their own dashboard/analytics; admins see everything. Not admin-only,
// since Dashboard.tsx/Analytics.tsx/JobManagement.tsx are used by regular recruiters today.
router.use(requireAuth, requireRole('recruiter', 'admin'));

// GET /api/analytics/dashboard - response shape (including the duplicate snake_case/camelCase
// fields) is also consumed by Dashboard.tsx and SwipeInterface.tsx, so it's preserved exactly;
// only the underlying computation moved from JS reduction over full tables to SQL aggregation
// (see db.getAnalyticsDashboardStats/getAnalyticsTrend/getAnalyticsRecentActivity).
router.get('/analytics/dashboard', async (req, res) => {
  try {
    const companyId = req.user!.company_id;

    const [stats, trends, recentActivity] = await Promise.all([
      db.getAnalyticsDashboardStats(companyId),
      db.getAnalyticsTrend(companyId),
      db.getAnalyticsRecentActivity(companyId, 5),
    ]);

    res.json({
      total_reviewed: stats.totalReviewed,
      matches_made: stats.matchesMade,
      avg_score: stats.avgScore,
      acceptance_rate: stats.acceptanceRate,
      trends,
      recent_activity: recentActivity,
      totalSwipesToday: stats.totalSwipesToday,
      acceptanceRate: stats.acceptanceRate,
      totalCandidatesReviewed: stats.totalReviewed,
      pendingCandidates: stats.pendingCandidates,
      swipesTrend: trends,
      recentActivity,
      // Dashboard-only additions - both nullable when there's no real basis to compute them
      // (see db.getAnalyticsDashboardStats), never a fabricated number.
      swipesYesterday: stats.swipesYesterday,
      swipesTodayChangePct: stats.swipesTodayChangePct,
      modelAccuracy: stats.modelAccuracy,
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard: ' + error.message });
  }
});

// GET /api/analytics/job/:job_id - response shape (total_reviewed/acceptance_rate/skillDistribution)
// consumed by JobManagement.tsx, preserved exactly.
router.get('/analytics/job/:job_id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const job_id = parseInt(req.params.job_id);
    if (isNaN(job_id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const job = await db.getJobById(job_id, companyId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const [perJobCounts, skillDistribution] = await Promise.all([
      db.getJobAnalyticsCounts(job_id, companyId),
      db.getAnalyticsSkillDistribution(companyId, { jobId: job_id, limit: 5 }),
    ]);

    res.json({
      total_reviewed: perJobCounts.totalReviewed,
      acceptance_rate: perJobCounts.acceptanceRate,
      skillDistribution,
    });
  } catch (error: any) {
    console.error('Job analytics error:', error);
    res.status(500).json({ error: 'Failed to load job analytics: ' + error.message });
  }
});

// GET /api/analytics/recruiter/me - always the logged-in user's own profile, derived from the
// session (req.user), never a client-supplied ID. Replaces the old /analytics/recruiter/:recruiter_id
// (which had no other caller) - that route hardcoded its response regardless of the ID requested,
// and incidentally let any recruiter view any teammate's individual stats, which was never an
// intentional feature.
router.get('/analytics/recruiter/me', async (req, res) => {
  try {
    const profile = await db.getAnalyticsRecruiterProfile(req.user!.user_id, req.user!.company_id);
    if (!profile) {
      return res.status(404).json({ error: 'Recruiter profile not found' });
    }
    res.json({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      swipesCount: profile.swipesCount,
      accepted: profile.accepted,
      rejected: profile.rejected,
      saved: profile.saved,
      acceptanceRate: profile.acceptanceRate,
      averageMatchScore: profile.averageMatchScore,
      avgTimeSpentSeconds: profile.avgDecisionTimeSeconds, // null -> frontend shows "N/A"
      lastLoginAt: profile.lastLoginAt,
      status: profile.isActive ? 'active' : 'disabled',
    });
  } catch (error: any) {
    console.error('Recruiter profile error:', error);
    res.status(500).json({ error: 'Failed to load recruiter profile: ' + error.message });
  }
});

router.get('/analytics/skills', async (req, res) => {
  try {
    const skillDistribution = await db.getAnalyticsSkillDistribution(req.user!.company_id, { limit: 8 });
    res.json(skillDistribution.map((s) => ({ skill: s.name, count: s.value })));
  } catch (error: any) {
    console.error('Skills analytics error:', error);
    res.status(500).json({ error: 'Failed to load skill analytics: ' + error.message });
  }
});

export default router;
