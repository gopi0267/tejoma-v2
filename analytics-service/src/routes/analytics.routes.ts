/**
 * Item 4: Analytics CQRS - routes query local denormalized read model (analytics_* tables).
 * If tables are empty, fall back to monolith for backward compatibility during transition.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { getDashboard, getJobAnalytics, getRecruiterProfile, getSkills, MonolithProxyError } from '../services/monolithClient.js';

const router = Router();
// Recruiters see their own dashboard/analytics; admins see everything. Not admin-only, matching
// the monolith's own analytics.routes.ts (Dashboard.tsx/Analytics.tsx/JobManagement.tsx are used
// by regular recruiters today).
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/analytics/dashboard', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const stats = await db.getDashboardStats(companyId);

    // Fall back to monolith if local cache is empty (transition period)
    if (!stats || (stats.total_reviewed === 0 && stats.totalCandidatesReviewed === 0)) {
      const monolithResult = await getDashboard(companyId);
      return res.json(monolithResult);
    }

    const trends = await db.getDailyTrends(companyId);
    const recentActivity = await db.getRecentActivity(companyId, 5);
    res.json({
      ...stats,
      trends,
      swipesTrend: trends,
      recentActivity,
    });
  } catch (error: any) {
    if (error instanceof MonolithProxyError) {
      logger.error({ status: error.status }, 'Failed to reach monolith for dashboard fallback');
      return res.status(502).json({ error: 'Failed to load dashboard' });
    }
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

    // Fall back to monolith if no local data
    if (!stats || stats.total_reviewed === 0) {
      const result = await getJobAnalytics(job_id, companyId);
      return res.json(result);
    }

    const skills = await db.getSkillDistribution(companyId, 5);
    res.json({
      total_reviewed: stats.total_reviewed,
      acceptance_rate: stats.acceptance_rate,
      skillDistribution: skills,
    });
  } catch (error: any) {
    if (error instanceof MonolithProxyError && error.status === 404) {
      return res.status(404).json({ error: 'Job not found' });
    }
    logger.error({ err: error.message }, 'Failed to load job analytics');
    res.status(500).json({ error: 'Failed to load job analytics' });
  }
});

router.get('/analytics/recruiter/me', async (req, res) => {
  try {
    const profile = await db.getRecruiterProfile(req.user!.user_id, req.user!.company_id);

    // Fall back to monolith if no local profile data
    if (!profile || profile.swipesCount === 0) {
      const result = await getRecruiterProfile(req.user!.user_id, req.user!.company_id);
      if (!result) {
        return res.status(404).json({ error: 'Recruiter profile not found' });
      }
      return res.json(result);
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
    if (error instanceof MonolithProxyError && error.status === 404) {
      return res.status(404).json({ error: 'Recruiter profile not found' });
    }
    logger.error({ err: error.message }, 'Failed to load recruiter profile');
    res.status(500).json({ error: 'Failed to load recruiter profile' });
  }
});

router.get('/analytics/skills', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const skillDistribution = await db.getSkillDistribution(companyId, 8);

    // Fall back to monolith if no local skill data
    if (!skillDistribution || skillDistribution.length === 0) {
      const result = await getSkills(companyId);
      return res.json(result.skillDistribution.map((s: any) => ({ skill: s.name, count: s.value })));
    }

    res.json(skillDistribution.map((s) => ({ skill: s.name, count: s.value })));
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to load skill analytics');
    res.status(500).json({ error: 'Failed to load skill analytics' });
  }
});

export default router;
