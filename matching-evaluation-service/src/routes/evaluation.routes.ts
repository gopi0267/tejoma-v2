/**
 * Ported from the monolith's src/api/ml.routes.ts - exactly the 4 routes this service now owns
 * (POST /ml/evaluate, GET /ml/evaluate/history, POST /ml/train/ranking, GET /ml/ranking/status).
 * The other 4 ml.routes.ts routes (/ml/config, /ml/train, /ml/model/status, /ml/model/versions)
 * stay on the monolith - see README.md's "Why this batch is scoped this narrowly". Byte-identical
 * response shapes and validation.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { runAndSaveEvaluation, DEFAULT_K } from '../matching/evaluation.js';
import { trainLearningToRank } from '../matching/learningToRank.js';
import { getRankerHealth } from '../algorithms/ltr-models.js';

const router = Router();
router.use(requireAuth);

router.post('/ml/train/ranking', requireRole('admin'), async (req, res) => {
  try {
    const result = await trainLearningToRank();
    res.json(result);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Learning-to-Rank training failed');
    res.status(500).json({ error: 'Failed to train Learning-to-Rank ensemble: ' + error.message });
  }
});

router.get('/ml/ranking/status', requireRole('recruiter', 'admin'), async (req, res) => {
  const [health, latestVersion] = await Promise.all([getRankerHealth(), db.getLatestLtrModelVersion()]);
  res.json({
    ranker_trained: health?.rankerTrained ?? false,
    trained_example_count: health?.rankerTrainedExampleCount ?? 0,
    trained_group_count: health?.rankerTrainedGroupCount ?? 0,
    ml_service_reachable: health !== null,
    latest_version: latestVersion,
    wired_into_live_scoring: false,
  });
});

router.post('/ml/evaluate', requireRole('admin'), async (req, res) => {
  try {
    const companyId = req.user!.company_id;
    const k = Number.isFinite(Number(req.body?.k)) && Number(req.body?.k) > 0 ? Number(req.body.k) : DEFAULT_K;
    const run = await runAndSaveEvaluation(companyId, k);
    if (!run) {
      return res.status(500).json({ error: 'Failed to save evaluation run' });
    }
    res.json(run);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Ranking evaluation failed');
    res.status(500).json({ error: 'Failed to run evaluation: ' + error.message });
  }
});

router.get('/ml/evaluate/history', requireRole('recruiter', 'admin'), async (req, res) => {
  const companyId = req.user!.company_id;
  const runs = await db.getEvaluationRuns(companyId);
  res.json(runs);
});

export default router;
