/**
 * Ported from the monolith's src/api/proficiency-analytics.routes.ts (Batch 25) - byte-identical
 * validation and response shapes. Both routes are served directly from this service's own
 * database (proficiency_shadow_scores, dual-written from the monolith's unchanged
 * shadowScoring.ts) - shadowDataHealth.ts additionally proxies to the monolith for job titles
 * (see its own header comment).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { computeProficiencyAnalyticsSummary } from '../matching/proficiencyAnalytics.js';
import { computeShadowDataHealth } from '../matching/shadowDataHealth.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/proficiency-analytics', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const summary = await computeProficiencyAnalyticsSummary(companyId);
    res.json(summary);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to compute proficiency analytics');
    res.status(500).json({ error: 'Failed to compute proficiency analytics: ' + error.message });
  }
});

router.get('/shadow-data-health', async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const summary = await computeShadowDataHealth(companyId);
    res.json(summary);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to compute shadow data health');
    res.status(500).json({ error: 'Failed to compute shadow data health: ' + error.message });
  }
});

export default router;
