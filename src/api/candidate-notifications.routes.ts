import { Router } from 'express';
import { db } from '../db.js';
import { requireCandidateAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Every route gated per-route (not router.use()) - same reasoning as every other
// candidate-facing router: this sits ahead of swipeRouter in src/api/index.ts, so a blanket
// gate here would 401 staff requests headed for later routers. Every query/update below is
// scoped server-side to req.candidate.candidate_id - ownership is never inferred from the
// request body/params alone.

router.get('/candidate-notifications', requireCandidateAuth, async (req, res) => {
  try {
    const notifications = await db.getCandidateNotifications(req.candidate!.candidate_id);
    res.json({ notifications });
  } catch (error) {
    console.error('Candidate notifications list error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/candidate-notifications/unread-count', requireCandidateAuth, async (req, res) => {
  try {
    const count = await db.getCandidateUnreadNotificationCount(req.candidate!.candidate_id);
    res.json({ count });
  } catch (error) {
    console.error('Candidate unread count error:', error);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

router.put('/candidate-notifications/read-all', requireCandidateAuth, async (req, res) => {
  try {
    const updated = await db.markAllCandidateNotificationsRead(req.candidate!.candidate_id);
    res.json({ updated });
  } catch (error) {
    console.error('Candidate mark-all-read error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

router.put('/candidate-notifications/:id/read', requireCandidateAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const updated = await db.markCandidateNotificationRead(id, req.candidate!.candidate_id);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Candidate mark-read error:', error);
    res.status(500).json({ error: 'Failed to mark notification read' });
  }
});

export default router;
