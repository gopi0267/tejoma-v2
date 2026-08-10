/**
 * Ported from the monolith's src/api/skill-intelligence.routes.ts (Batch 27) - byte-identical
 * validation, auth gating, and response shapes. Served from this service's own database. Not yet
 * gateway-routed (see README.md's "Why this isn't gateway-routed yet") - reachable directly today
 * only for manual/operator verification, same "built and validated, not yet cut over" status every
 * other service in this migration started at.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { approveProposal, rejectProposal } from '../matching/unknownSkillDiscovery.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth);

router.get('/skills/discovery/pending', requireRole('recruiter', 'admin'), async (req, res) => {
  const limit = Number.isFinite(Number(req.query.limit)) && Number(req.query.limit) > 0 ? Number(req.query.limit) : 50;
  const proposals = await db.getPendingSkillDiscoveryProposals(limit);
  res.json(proposals);
});

router.post('/skills/discovery/:id/approve', requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid proposal ID' });

    const node = await approveProposal(id, req.user!.user_id);
    if (!node) {
      return res.status(404).json({ error: 'Proposal not found, not pending, or promotion failed' });
    }
    res.json({ success: true, skill_node: node });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to approve skill discovery proposal');
    res.status(500).json({ error: 'Failed to approve proposal: ' + error.message });
  }
});

router.post('/skills/discovery/:id/reject', requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid proposal ID' });

    const proposal = await rejectProposal(id, req.user!.user_id);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found or not pending' });
    }
    res.json({ success: true, proposal });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Failed to reject skill discovery proposal');
    res.status(500).json({ error: 'Failed to reject proposal: ' + error.message });
  }
});

export default router;
