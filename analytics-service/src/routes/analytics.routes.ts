/**
 * Item 4: Analytics CQRS - routes query local denormalized read model (analytics_* tables).
 * Production mode: No monolith fallback. Services operate independently.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';

const router = Router();
// Recruiters see their own dashboard/analytics; admins see everything. Not admin-only, matching
// the monolith's own analytics.routes.ts (Dashboard.tsx/Analytics.tsx/JobManagement.tsx are used
// by regular recruiters today).

router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/analytics/dashboard', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const stats = await db.getDashboardStats(companyId);

    // Return default empty stats if cache not yet populated (allows dashboard to load even without backfill)
    const dbStats = stats || {
      total_reviewed: 0,
      matches_made: 0,
      avg_score: 0,
      acceptance_rate: 0,
      total_swipes_today: 0,
      total_swipes_yesterday: 0,
      pending_candidates: 0,
      model_accuracy: null,
    };

    const trends = await db.getDailyTrends(companyId);
    const recentActivity = await db.getRecentActivity(companyId, 5);

    // Convert snake_case from DB to camelCase for frontend
    res.json({
      totalCandidatesReviewed: dbStats.total_reviewed || 0,
      matchesMade: dbStats.matches_made || 0,
      avgScore: dbStats.avg_score || 0,
      acceptanceRate: dbStats.acceptance_rate || 0,
      totalSwipesToday: dbStats.total_swipes_today || 0,
      swipesTodayChangePct: null,
      totalSwipesYesterday: dbStats.total_swipes_yesterday || 0,
      pendingCandidates: dbStats.pending_candidates || 0,
      modelAccuracy: dbStats.model_accuracy,
      trends: trends || [],
      swipesTrend: trends || [],
      recent_activity: recentActivity || [],
    });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load dashboard');
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.get('/analytics/job/:job_id', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const job_id = parseInt(req.params.job_id);
    if (isNaN(job_id)) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }
    const stats = await db.getJobStats(job_id, companyId);

    // Return empty stats if no local data (no monolith fallback for production)
    if (!stats) {
      return res.json({ total_reviewed: 0, acceptance_rate: 0, skillDistribution: [] });
    }

    const skills = await db.getSkillDistribution(companyId, 5);
    res.json({
      total_reviewed: stats.total_reviewed,
      acceptance_rate: stats.acceptance_rate,
      skillDistribution: skills,
    });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load job analytics');
    res.status(500).json({ error: 'Failed to load job analytics' });
  }
});

router.get('/analytics/recruiter/me', async (req, res) => {
  try {
    const profile = await db.getRecruiterProfile(req.user!.user_id, req.user!.company_id);

    // No monolith fallback for production - return current stats or empty
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
      avgTimeSpentSeconds: profile.avgDecisionTimeSeconds,
      lastLoginAt: profile.lastLoginAt,
      status: profile.isActive ? 'active' : 'disabled',
    });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load recruiter profile');
    res.status(500).json({ error: 'Failed to load recruiter profile' });
  }
});

router.get('/analytics/skills', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const skillDistribution = await db.getSkillDistribution(companyId, 8);

    // No monolith fallback for production - return current aggregations or empty
    res.json((skillDistribution || []).map((s) => ({ skill: s.name, count: s.value })));
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load skill analytics');
    res.status(500).json({ error: 'Failed to load skill analytics' });
  }
});

export default router;
