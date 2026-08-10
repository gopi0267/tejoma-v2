import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { parseJobDescription } from '../jd-parser/index.js';
import { JobDescriptionValidationError } from '../jd-parser/schema.js';
import { logger } from '../utils/logger.js';
import { ACCESS_TOKEN_COOKIE } from '../utils/tokens.js';
// Tier 0 migration (Batch 15) - see src/jdParserShadow.ts's header comment for the full contract.
// Disabled by default (SHADOW_JD_PARSER_ENABLED); a no-op until an operator opts in.
import { shadowParseJobDescription } from '../jdParserShadow.js';
import type { JobDescriptionParseResult } from '../jd-parser/types.js';

const router = Router();
router.use(requireAuth, requireRole('recruiter', 'admin'));

router.post('/jobs/parse-description', async (req, res) => {
  // Batch 15 shadow-validation: registered before any early return, fires exactly once after the
  // response has actually been sent (res.on('finish')), mirroring auth.routes.ts's POST
  // /auth/login shadow-read hook exactly. See src/jdParserShadow.ts's header comment.
  let shadowResult: JobDescriptionParseResult | null = null;
  res.on('finish', () => {
    const accessToken = req.cookies?.[ACCESS_TOKEN_COOKIE] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (shadowResult && accessToken) {
      shadowParseJobDescription(shadowResult.sourceText, shadowResult, accessToken);
    }
  });

  try {
    const { text } = req.body as { text?: string };

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Job description text is required.' });
    }
    if (text.length > 50_000) {
      return res.status(400).json({ error: 'Job description text is too long (max 50,000 characters).' });
    }

    const result = await parseJobDescription(text);
    shadowResult = result;
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
