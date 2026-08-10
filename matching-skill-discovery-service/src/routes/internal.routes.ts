/**
 * Internal, monolith-to-service endpoint for Matching Skill Discovery Service (Batch 27). Same
 * inverted direction as matching-reasoning-service's /internal/compute-for-candidate: the monolith
 * calls this service (its own src/skillDiscoveryServiceShadow.ts, fire-and-forget, gated behind
 * SHADOW_SKILL_DISCOVERY_ENABLED). Trusted by network boundary, no JWT.
 *
 * Always runs with skipPromotion=true - see unknownSkillDiscovery.ts's discoverUnknownSkill header
 * comment for why a shadow-triggered run must never independently promote a real skill node.
 */
import { Router } from 'express';
import { discoverUnknownSkills } from '../matching/unknownSkillDiscovery.js';

const router = Router();

router.post('/discover', async (req, res) => {
  try {
    const { rawSkills, contextText, sourceType } = req.body;
    if (!Array.isArray(rawSkills) || (sourceType !== 'resume' && sourceType !== 'jd')) {
      return res.status(400).json({ error: 'rawSkills[] and sourceType (resume|jd) are required' });
    }
    const outcomes = await discoverUnknownSkills(rawSkills, contextText || '', sourceType, true);
    res.json({ outcomes });
  } catch (error) {
    console.error('[internal] discover error:', error);
    res.status(500).json({ error: 'Failed to run discovery' });
  }
});

export default router;
