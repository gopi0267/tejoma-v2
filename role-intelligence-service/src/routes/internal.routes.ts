/**
 * Internal read endpoints for Role Intelligence Service (Batch 29). No JWT - trusted by network
 * boundary. No route in the monolith currently exposes role-profile data over HTTP at all, so
 * these are the first real endpoints for this data anywhere in the system - built and ready for
 * whichever future caller needs it, not yet consumed by anything (same "built, not yet wired"
 * status every new capability in this migration starts at).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { matchRoleByTitle } from '../matching/roleIntelligence.js';

const router = Router();

router.get('/role-profiles', async (_req, res) => {
  try {
    const profiles = await db.getAllRoleProfiles();
    res.json({ profiles });
  } catch (error) {
    console.error('[internal] role-profiles error:', error);
    res.status(500).json({ error: 'Failed to fetch role profiles' });
  }
});

router.get('/role-profiles/:roleKey', async (req, res) => {
  try {
    const profile = await db.getRoleProfileByKey(req.params.roleKey);
    if (!profile) return res.status(404).json({ error: 'Role profile not found' });
    res.json({ profile });
  } catch (error) {
    console.error('[internal] role-profiles/:roleKey error:', error);
    res.status(500).json({ error: 'Failed to fetch role profile' });
  }
});

router.post('/match-role-by-title', async (req, res) => {
  try {
    const { title } = req.body;
    if (typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    const match = await matchRoleByTitle(title);
    res.json({ match });
  } catch (error) {
    console.error('[internal] match-role-by-title error:', error);
    res.status(500).json({ error: 'Failed to match role by title' });
  }
});

export default router;
