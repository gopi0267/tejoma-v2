/**
 * Ported from the monolith's src/api/candidate-notifications.routes.ts - byte-identical response
 * shapes, byte-identical validation. Reads/writes this service's own database directly (no
 * monolith proxy needed - candidate_notifications is fully owned here as of Batch 20).
 */
import { Router } from 'express';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';
import { getCandidateNotifications, getCandidateUnreadNotificationCount, markCandidateNotificationRead, markAllCandidateNotificationsRead } from '../db.js';

const router = Router();
router.use(requireCandidateAuth);

router.get('/candidate-notifications', async (req, res) => {
  const notifications = await getCandidateNotifications(req.candidate!.candidate_id);
  res.json({ notifications });
});

router.get('/candidate-notifications/unread-count', async (req, res) => {
  const count = await getCandidateUnreadNotificationCount(req.candidate!.candidate_id);
  res.json({ count });
});

router.put('/candidate-notifications/read-all', async (req, res) => {
  const updated = await markAllCandidateNotificationsRead(req.candidate!.candidate_id);
  res.json({ updated });
});

router.put('/candidate-notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid notification id' });
  }
  const ok = await markCandidateNotificationRead(id, req.candidate!.candidate_id);
  if (!ok) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ success: true });
});

export default router;
