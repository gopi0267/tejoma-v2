/**
 * Mounted at the exact same public path the monolith serves today (POST /api/jobs/parse-
 * description) - byte-identical request/response contract to src/api/jd-parser.routes.ts, so
 * cutting API Gateway's routing table over to this service (see MIGRATION_RUNBOOK.md's
 * path-by-path cutover model) requires zero frontend changes. The pipeline call itself
 * (parseJobDescription) is the exact ported code from src/jd-parser/ - same validation, same
 * error handling, same success/error response shapes as the monolith's route.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { parseJobDescription } from '../jd-parser/index.js';
import { JobDescriptionValidationError } from '../jd-parser/schema.js';
import { logger } from '../utils/logger.js';
import { jdParseDuration, jdParseCount, jdParseNlpAvailability } from '../utils/metrics.js';

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

    const nlpFieldSources = result.fieldSources.filter((f) => f.tier === 'nlp');
    jdParseDuration.observe({ nlp_tier: nlpFieldSources.length > 0 ? 'true' : 'false' }, result.parseTimeMs / 1000);
    jdParseNlpAvailability.inc({ available: nlpFieldSources.length > 0 ? 'true' : 'false' });
    jdParseCount.inc({ outcome: 'success' });

    res.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof JobDescriptionValidationError) {
      jdParseCount.inc({ outcome: 'validation_error' });
      return res.status(422).json({ success: false, error: error.message, issues: error.issues });
    }
    jdParseCount.inc({ outcome: 'error' });
    logger.error({ err: error.message }, 'JD parse request failed');
    res.status(500).json({ success: false, error: 'Failed to parse job description: ' + error.message });
  }
});

export default router;
