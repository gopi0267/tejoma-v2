/**
 * ML admin surface - Item 3 (final monolith migration item): now owns activeModelType,
 * isRetrainingInProgress, lastTrainingTimestamp locally instead of proxying to the monolith.
 * Training orchestration (trainModelOnStartup) is still called via monolithClient for now
 * (batch job with cross-service data dependencies).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { trainModel, MonolithProxyError } from '../services/monolithClient.js';
import { activeModelType, isRetrainingInProgress, lastTrainingTimestamp, setActiveModelType } from '../matching/services.js';
import { getEnsembleHealth } from '../algorithms/ml-models.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(requireAuth);

function handleProxyError(error: unknown, res: import('express').Response, fallbackMessage: string) {
  if (error instanceof MonolithProxyError) {
    return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json(error.body?.error ? error.body : { error: fallbackMessage });
  }
  logger.error({ err: (error as Error)?.message }, fallbackMessage);
  res.status(500).json({ error: fallbackMessage });
}

router.get('/ml/config', requireRole('recruiter', 'admin'), (_req, res) => {
  res.json({ activeModelType, isRetrainingInProgress, lastTrainingTimestamp });
});

router.post('/ml/config', requireRole('admin'), (req, res) => {
  const { activeModelType: newType } = req.body;
  if (!newType || !['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'].includes(newType)) {
    return res.status(400).json({ error: 'Invalid activeModelType' });
  }
  setActiveModelType(newType);
  res.json({ activeModelType: newType, isRetrainingInProgress, lastTrainingTimestamp });
});

router.post('/ml/train', requireRole('admin'), async (_req, res) => {
  try {
    res.json(await trainModel());
  } catch (error) {
    handleProxyError(error, res, 'Failed to retrain');
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
