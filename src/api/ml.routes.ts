import { Router } from 'express';
import { db } from '../db.js';
import {
    activeModelType,
    isRetrainingInProgress,
    lastTrainingTimestamp,
    setActiveModelType,
    setRetrainingStatus,
    updateLastTrainingTimestamp,
    trainModelOnStartup,
} from '../matching/services.js';
import { getEnsembleHealth } from '../algorithms/ml-models.js';
import { getRankerHealth } from '../algorithms/ltr-models.js';
import { trainLearningToRank } from '../matching/learningToRank.js';
import { runAndSaveEvaluation, DEFAULT_K } from '../matching/evaluation.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth);

router.get('/ml/config', requireRole('recruiter', 'admin'), (req, res) => {
    res.json({
      activeModelType,
      isRetrainingInProgress,
      lastTrainingTimestamp
    });
});

router.post('/ml/config', requireRole('admin'), async (req, res) => {
    const { activeModelType: newType } = req.body;
    if (newType && ['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'].includes(newType)) {
      try {
        // Now persists to matching_model_config, not just an in-memory mutation - see
        // src/matching/services.ts's header comment on activeModelType (Batch 23).
        await setActiveModelType(newType);
        res.json({ activeModelType: newType, isRetrainingInProgress, lastTrainingTimestamp });
      } catch (error: any) {
        logger.error({ err: error.message }, 'Failed to persist active model type');
        res.status(500).json({ error: 'Failed to save model configuration: ' + error.message });
      }
    } else {
      res.status(400).json({ error: 'Invalid activeModelType' });
    }
});

// Retrains the RandomForest + XGBoost + LightGBM ensemble (python-services/matching-ml-service)
// on the full swipe history. trainModelOnStartup builds the feature vectors and calls the
// service's /train endpoint - shared with the boot-time training call, so there's one training
// code path, not two.
router.post('/ml/train', requireRole('admin'), async (req, res) => {
    setRetrainingStatus(true);
    broadcastEvent('model-training-started', {});
    try {
      await trainModelOnStartup();
      setRetrainingStatus(false);

      const health = await getEnsembleHealth();
      broadcastEvent('model-retrained', { trained: health?.ensembleTrained ?? false, sampleCount: health?.trainedSampleCount ?? 0 });

      res.json({ success: true, activeModelType, isRetrainingInProgress, lastTrainingTimestamp, ensembleTrained: health?.ensembleTrained ?? false, trainedSampleCount: health?.trainedSampleCount ?? 0 });
    } catch (error: any) {
      setRetrainingStatus(false);
      res.status(500).json({ error: 'Failed to retrain: ' + error.message });
    }
});

router.get('/ml/model/status', requireRole('recruiter', 'admin'), async (req, res) => {
    // Swipe count reflects the pooled cross-company training set the ensemble actually trains
    // on (see db.getAllSwipesUnscoped), consistent with trained_sample_count above.
    const [health, swipes] = await Promise.all([getEnsembleHealth(), db.getAllSwipesUnscoped()]);
    res.json({
      ensemble_trained: health?.ensembleTrained ?? false,
      trained_sample_count: health?.trainedSampleCount ?? 0,
      total_swipes_available: swipes.length,
      last_trained: lastTrainingTimestamp,
      ml_service_reachable: health !== null,
    });
});

router.get('/ml/model/versions', requireRole('recruiter', 'admin'), (req, res) => {
    res.json([]);
});

// ==================== LEARNING-TO-RANK (Phase 3) ====================
// Fully isolated from the routes above - trains/reports on the new XGBRanker/LGBMRanker
// capability (src/matching/learningToRank.ts), never reads or writes activeModelType/
// isRetrainingInProgress/lastTrainingTimestamp (those belong to the production classification
// ensemble only), and is never called by any live scoring route.
router.post('/ml/train/ranking', requireRole('admin'), async (req, res) => {
    try {
      const result = await trainLearningToRank();
      broadcastEvent('ranking-model-trained', result);
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
      // Explicit, not implied by absence of an error - this capability does not affect what any
      // recruiter/candidate currently sees.
      wired_into_live_scoring: false,
    });
});

// ==================== EVALUATION FRAMEWORK (Phase 3) ====================
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
