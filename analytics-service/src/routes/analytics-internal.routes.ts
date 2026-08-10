/**
 * Internal API for Analytics Service - receives mirror events from monolith and services
 * to populate the local read model (CQRS denormalized tables).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { getDashboard, getJobAnalytics, getRecruiterProfile, getSkills } from '../services/monolithClient.js';

const router = Router();

// Bootstrap endpoint to populate analytics from monolith (called on startup if needed)
router.post('/bootstrap', async (req, res) => {
  try {
    const companyIds = req.body.companyIds as number[] || [];
    if (companyIds.length === 0) {
      return res.status(400).json({ error: 'companyIds array required' });
    }

    let successCount = 0;
    for (const companyId of companyIds) {
      try {
        const dashboardStats = await getDashboard(companyId);
        if (dashboardStats) {
          await db.upsertDashboardStats(companyId, {
            totalReviewed: dashboardStats.total_reviewed,
            matchesMade: dashboardStats.matches_made,
            avgScore: dashboardStats.avg_score,
            acceptanceRate: dashboardStats.acceptance_rate,
            totalSwipesToday: dashboardStats.totalSwipesToday,
            swipesYesterday: dashboardStats.swipesYesterday,
            pendingCandidates: dashboardStats.pendingCandidates,
            modelAccuracy: dashboardStats.modelAccuracy,
          });
          successCount++;
        }
      } catch (error) {
        logger.warn({ err: error, companyId }, 'Failed to bootstrap analytics for company');
      }
    }

    res.json({ success: true, bootstrappedCount: successCount, totalRequested: companyIds.length });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to bootstrap analytics');
    res.status(500).json({ error: error.message });
  }
});

router.post('/dashboard-cache', async (req, res) => {
  try {
    const { companyId, stats } = req.body;
    if (!companyId || !stats) {
      return res.status(400).json({ error: 'companyId and stats are required' });
    }
    await db.upsertDashboardStats(companyId, stats);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to upsert dashboard cache');
    res.status(500).json({ error: error.message });
  }
});

router.post('/recent-activity', async (req, res) => {
  try {
    const { companyId, activity } = req.body;
    if (!companyId || !activity) {
      return res.status(400).json({ error: 'companyId and activity are required' });
    }
    await db.upsertRecentActivity(companyId, activity);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to upsert recent activity');
    res.status(500).json({ error: error.message });
  }
});

router.post('/job-stats', async (req, res) => {
  try {
    const { companyId, jobId, stats } = req.body;
    if (!companyId || !jobId || !stats) {
      return res.status(400).json({ error: 'companyId, jobId, and stats are required' });
    }
    await db.upsertJobStats(companyId, jobId, stats);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to upsert job stats');
    res.status(500).json({ error: error.message });
  }
});

router.post('/skill', async (req, res) => {
  try {
    const { companyId, skill, count } = req.body;
    if (!companyId || !skill || count === undefined) {
      return res.status(400).json({ error: 'companyId, skill, and count are required' });
    }
    await db.upsertSkillDistribution(companyId, skill, count);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to upsert skill distribution');
    res.status(500).json({ error: error.message });
  }
});

router.post('/recruiter-profile', async (req, res) => {
  try {
    const { companyId, profile } = req.body;
    if (!companyId || !profile) {
      return res.status(400).json({ error: 'companyId and profile are required' });
    }
    await db.upsertRecruiterProfile(companyId, profile);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to upsert recruiter profile');
    res.status(500).json({ error: error.message });
  }
});

export default router;
