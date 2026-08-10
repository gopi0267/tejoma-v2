/**
 * Internal, monolith-to-service endpoint for Career Intelligence Service (Batch 30). Same
 * inverted direction as Batch 26/27's shadow-comparison endpoints: the monolith calls this
 * service (via src/careerIntelligenceServiceShadow.ts, fire-and-forget, gated behind
 * SHADOW_CAREER_INTELLIGENCE_ENABLED). Trusted by network boundary, no JWT. This service has no
 * other HTTP surface (no gateway routing).
 *
 * Runs this service's own ported computeCareerTrajectory against its own dual-written
 * role_profiles mirror, stores the result in its own owned career_trajectories table, and returns
 * it so the monolith's shadow caller can diff it against what the monolith's own (unchanged)
 * computation just produced.
 */
import { Router } from 'express';
import { computeCareerTrajectory } from '../matching/careerIntelligence/computeCareerTrajectory.js';

const router = Router();

router.post('/compute-for-candidate', async (req, res) => {
  try {
    const { candidateId, companyId, workHistory } = req.body;
    if (typeof candidateId !== 'number' || typeof companyId !== 'number') {
      return res.status(400).json({ error: 'candidateId and companyId are required' });
    }
    const trajectory = await computeCareerTrajectory(candidateId, companyId, workHistory);
    res.json({ trajectory });
  } catch (error) {
    console.error('[internal] compute-for-candidate error:', error);
    res.status(500).json({ error: 'Failed to compute career trajectory for candidate' });
  }
});

export default router;
