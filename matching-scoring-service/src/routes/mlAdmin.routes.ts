/**
 * ML admin surface - Item 3 (final monolith migration item): now owns activeModelType,
 * isRetrainingInProgress, lastTrainingTimestamp locally instead of proxying to the monolith.
 * Training orchestration (trainModelOnStartup) is still called via monolithClient for now
 * (batch job with cross-service data dependencies).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { trainClassificationEnsemble } from '../matching/trainEnsembleModel.js';
import { activeModelType, isRetrainingInProgress, lastTrainingTimestamp, setActiveModelType, setRetrainingStatus } from '../matching/services.js';
import { getEnsembleHealth } from '../algorithms/ml-models.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth);

// handleProxyError removed with the monolith proxy - every route here now serves locally and
// reports its own errors directly.

router.get('/ml/config', requireRole('recruiter', 'admin'), (_req, res) => {
  res.json({ activeModelType, isRetrainingInProgress, lastTrainingTimestamp });
});

router.post('/ml/config', requireRole('admin'), async (req, res) => {
  const { activeModelType: newType } = req.body;
  if (!newType || !['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'].includes(newType)) {
    return res.status(400).json({ error: 'Invalid activeModelType' });
  }
  await setActiveModelType(newType);
  res.json({ activeModelType: newType, isRetrainingInProgress, lastTrainingTimestamp });
});

router.post('/ml/train', requireRole('admin'), async (_req, res) => {
  // Trains locally. This previously proxied to the monolith's /internal/ml/train
  // (monolithClient.trainModel) - the last business-critical monolith dependency. The training
  // logic now lives here in trainEnsembleModel.ts, reading from the services that own each
  // dataset. Response shape is unchanged from what the monolith returned, so the ML admin UI
  // needs no change.
  try {
    await setRetrainingStatus(true);
    const report = await trainClassificationEnsemble();
    await setRetrainingStatus(false);

    const health = await getEnsembleHealth();
    res.json({
      success: true,
      activeModelType,
      isRetrainingInProgress,
      lastTrainingTimestamp,
      ensembleTrained: health?.ensembleTrained ?? false,
      trainedSampleCount: health?.trainedSampleCount ?? 0,
      trained: report.trained,
      sampleCount: report.sampleCount,
      cvAccuracy: report.cvAccuracy ?? null,
      statusCorroboratedSamples: report.statusCorroboratedSamples ?? 0,
      ...(report.reason ? { reason: report.reason } : {}),
    });
  } catch (error) {
    await setRetrainingStatus(false).catch(() => {});
    logger.error({ err: (error as Error)?.message }, 'Failed to retrain');
    res.status(500).json({ error: 'Failed to retrain: ' + (error as Error)?.message });
  }
});

router.get('/ml/model/status', requireRole('recruiter', 'admin'), async (_req, res) => {
  try {
    const health = await getEnsembleHealth();
    res.json({
      activeModelType,
      isRetrainingInProgress,
      lastTrainingTimestamp,
      ensembleTrained: health?.ensembleTrained ?? false,
      trainedSampleCount: health?.trainedSampleCount ?? 0,
    });
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to load model status');
    res.status(500).json({ error: 'Failed to load model status' });
  }
});

router.get('/ml/model/versions', requireRole('recruiter', 'admin'), async (_req, res) => {
  try {
    const health = await getEnsembleHealth();
    res.json({
      models: ['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'],
      activeModel: activeModelType,
      ensembleTrained: health?.ensembleTrained ?? false,
      lastTrainingTime: lastTrainingTimestamp,
    });
  } catch (error) {
    logger.error({ err: (error as Error)?.message }, 'Failed to load model versions');
    res.status(500).json({ error: 'Failed to load model versions' });
  }
});

export default router;
