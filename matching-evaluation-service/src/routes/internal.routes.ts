/**
 * Internal, monolith-to-service endpoint for the shadow-weighting cluster (Batch 31). Same
 * inverted direction as Batch 26/30's shadow-comparison endpoints: the monolith calls this
 * service (via src/matchingEvaluationServiceShadow.ts, fire-and-forget, gated behind
 * SHADOW_MATCHING_EVALUATION_ENABLED). Trusted by network boundary, no JWT - unlike this service's
 * other routes (evaluation.routes.ts, shadowAnalytics.routes.ts), which are real recruiter-facing
 * endpoints behind requireAuth.
 *
 * Runs this service's own ported computeShadowWeighting against its own dual-written mirrors
 * (skill_nodes/role_profiles/career_trajectories/reasoning_conclusions), stores the result in its
 * own owned shadow_weighting_computations table, and returns it so the monolith's shadow caller
 * can diff it against what the monolith's own (unchanged) shadowScoring.ts just computed.
 */
import { Router } from 'express';
import { computeShadowWeighting } from '../matching/shadowScoring.js';

const router = Router();

router.post('/compute-shadow-weighting', async (req, res) => {
  try {
    const { companyId, candidate, job, matchedSkills, baseScore, decisionAction } = req.body;
    if (typeof companyId !== 'number' || !candidate || !job || !Array.isArray(matchedSkills) || typeof baseScore !== 'number') {
      return res.status(400).json({ error: 'companyId, candidate, job, matchedSkills, and baseScore are required' });
    }
    const computation = await computeShadowWeighting(companyId, candidate, job, matchedSkills, baseScore, decisionAction ?? null);
    res.json({ computation });
  } catch (error) {
    console.error('[internal] compute-shadow-weighting error:', error);
    res.status(500).json({ error: 'Failed to compute shadow weighting' });
  }
});

export default router;
