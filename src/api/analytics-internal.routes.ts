/**
 * Internal, service-to-service endpoints for Analytics Service (Batch 22) - this service owns
 * nothing directly, so every one of its routes proxies here. Mirrors the trust model every other
 * Tier 0 service's /internal/* already documents: no JWT here, gated by network boundary (API
 * Gateway's proxy.ts already 404s /internal/* unconditionally; Analytics Service calls this
 * directly via MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * Every handler is a thin wrapper around the EXACT db.ts functions the monolith's own
 * src/api/analytics.routes.ts already calls - same queries, same company scoping, same response
 * shapes (including the duplicate snake_case/camelCase fields on /dashboard, preserved exactly
 * since Dashboard.tsx/SwipeInterface.tsx still consume them). Nothing here is new business logic;
 * only the entry point moved from "call directly, in-process" to "trust the network boundary,
 * read companyId/userId from the request."
 */
import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

router.get('/dashboard', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }

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
      swipesYesterday: stats.swipesYesterday,
      swipesTodayChangePct: stats.swipesTodayChangePct,
      modelAccuracy: stats.modelAccuracy,
    });
  } catch (error) {
    console.error('[internal/analytics] dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.get('/job/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(jobId) || Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'A valid jobId and companyId are required' });
    }

    const job = await db.getJobById(jobId, companyId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const [perJobCounts, skillDistribution] = await Promise.all([
      db.getJobAnalyticsCounts(jobId, companyId),
      db.getAnalyticsSkillDistribution(companyId, { jobId, limit: 5 }),
    ]);

    res.json({
      total_reviewed: perJobCounts.totalReviewed,
      acceptance_rate: perJobCounts.acceptanceRate,
      skillDistribution,
    });
  } catch (error) {
    console.error('[internal/analytics] job analytics error:', error);
    res.status(500).json({ error: 'Failed to load job analytics' });
  }
});

router.get('/recruiter-profile', async (req, res) => {
  try {
    const userId = parseInt(String(req.query.userId), 10);
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(userId) || Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'A valid userId and companyId are required' });
    }

    const profile = await db.getAnalyticsRecruiterProfile(userId, companyId);
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
  } catch (error) {
    console.error('[internal/analytics] recruiter profile error:', error);
    res.status(500).json({ error: 'Failed to load recruiter profile' });
  }
});

router.get('/skills', async (req, res) => {
  try {
    const companyId = parseInt(String(req.query.companyId), 10);
    if (Number.isNaN(companyId)) {
      return res.status(400).json({ error: 'companyId is required' });
    }
    const skillDistribution = await db.getAnalyticsSkillDistribution(companyId, { limit: 8 });
    res.json({ skillDistribution });
  } catch (error) {
    console.error('[internal/analytics] skills error:', error);
    res.status(500).json({ error: 'Failed to load skill analytics' });
  }
});

export default router;
