import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

// A brand-new, standalone file so swipe.routes.ts/recruiter-review.routes.ts are never touched.
// Every query/update is scoped to (user_id, company_id) server-side - a recruiter's
// notifications are personal (addressed to whoever's swipe completed the match) and never
// shared across colleagues or companies.

router.get('/recruiter-notifications', async (req, res) => {
  try {
    const notifications = await db.getRecruiterNotifications(req.user!.user_id, req.user!.company_id);
    res.json({ notifications });
  } catch (error) {
    console.error('Recruiter notifications list error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/recruiter-notifications/unread-count', async (req, res) => {
  try {
    const count = await db.getRecruiterUnreadNotificationCount(req.user!.user_id, req.user!.company_id);
    res.json({ count });
  } catch (error) {
    console.error('Recruiter unread count error:', error);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

router.put('/recruiter-notifications/read-all', async (req, res) => {
  try {
    const updated = await db.markAllRecruiterNotificationsRead(req.user!.user_id, req.user!.company_id);
    res.json({ updated });
  } catch (error) {
    console.error('Recruiter mark-all-read error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

router.put('/recruiter-notifications/:id/read', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }
    const updated = await db.markRecruiterNotificationRead(id, req.user!.user_id, req.user!.company_id);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Recruiter mark-read error:', error);
    res.status(500).json({ error: 'Failed to mark notification read' });
  }
});

export default router;
