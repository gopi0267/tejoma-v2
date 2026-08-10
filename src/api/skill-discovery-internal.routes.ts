/**
 * Internal, service-to-service endpoint for Matching Skill Discovery Service (Batch 27) - the one
 * write matching-skill-discovery-service doesn't own: promoting a proposal into a real
 * skill_nodes/skill_edges row. Mirrors the trust model every other Tier 0 service's /internal/*
 * already documents: no JWT here, gated by network boundary (API Gateway's proxy.ts already 404s
 * /internal/* unconditionally; matching-skill-discovery-service calls this directly via
 * MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * This is a thin wrapper around the EXACT same db.ts functions the monolith's own
 * src/matching/unknownSkillDiscovery.ts's promoteToSkillNode already calls (db.upsertSkillNode,
 * db.upsertSkillEdge - both UNCHANGED, still running in-process for real traffic). Nothing here is
 * new business logic - it's the same two writes, reachable from a second caller.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { domainFor } from '../matching/skillIntelligence.js';

const router = Router();

router.post('/promote', async (req, res) => {
  try {
    const { rawToken, proposedCategory, confidence, relationshipType, relatedSkillId } = req.body;
    if (typeof rawToken !== 'string' || !rawToken.trim() || typeof confidence !== 'number') {
      return res.status(400).json({ error: 'rawToken and confidence are required' });
    }

    const category = proposedCategory ?? 'general';
    const node = await db.upsertSkillNode({
      canonical_name: rawToken,
      category,
      technology_domain: domainFor(category),
      aliases: [rawToken],
      is_emerging: true,
      source: 'unknown_skill_discovery',
      confidence,
    });

    if (node && relationshipType && relatedSkillId) {
      await db.upsertSkillEdge(node.id, relatedSkillId, relationshipType, confidence, 'unknown_skill_discovery');
      await db.upsertSkillEdge(relatedSkillId, node.id, relationshipType, confidence, 'unknown_skill_discovery');
    }

    res.json({ skill_node: node });
  } catch (error) {
    console.error('[internal/skill-discovery] promote error:', error);
    res.status(500).json({ error: 'Failed to promote skill node' });
  }
});

export default router;
