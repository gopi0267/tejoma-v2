/**
 * Ported from the monolith's src/api/recruiter-notifications.routes.ts - that file's own header
 * comment already stated it was "brand-new, standalone... swipe.routes.ts/recruiter-review.routes.ts
 * are never touched," confirming zero Matching-domain coupling (Batch 19 domain audit). Same
 * routes, same scoping (user_id, company_id) taken from the authenticated staff session, never
 * a route param - now served directly from this service's own database instead of proxying.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { getRecruiterNotifications, getRecruiterUnreadNotificationCount, markRecruiterNotificationRead, markAllRecruiterNotificationsRead } from '../db.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.get('/recruiter-notifications', async (req, res) => {
  const notifications = await getRecruiterNotifications(req.user!.user_id, req.user!.company_id);
  res.json({ notifications });
});

router.get('/recruiter-notifications/unread-count', async (req, res) => {
  const count = await getRecruiterUnreadNotificationCount(req.user!.user_id, req.user!.company_id);
  res.json({ count });
});

router.put('/recruiter-notifications/read-all', async (req, res) => {
  const updated = await markAllRecruiterNotificationsRead(req.user!.user_id, req.user!.company_id);
  res.json({ updated });
});

router.put('/recruiter-notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid notification id' });
  }
  const ok = await markRecruiterNotificationRead(id, req.user!.user_id, req.user!.company_id);
  if (!ok) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({ success: true });
});

export default router;
