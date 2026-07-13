import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { parseJobDescription } from '../jd-parser/index.js';
import { JobDescriptionValidationError } from '../jd-parser/schema.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.post('/jobs/parse-description', async (req, res) => {
  try {
    const { text } = req.body as { text?: string };

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Job description text is required.' });
    }
    if (text.length > 50_000) {
      return res.status(400).json({ error: 'Job description text is too long (max 50,000 characters).' });
    }

    const result = await parseJobDescription(text);
    res.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof JobDescriptionValidationError) {
      return res.status(422).json({ success: false, error: error.message, issues: error.issues });
    }
    logger.error({ err: error.message }, 'JD parse request failed');
    res.status(500).json({ success: false, error: 'Failed to parse job description: ' + error.message });
  }
});

export default router;
