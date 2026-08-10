/**
 * Internal, service-to-service endpoints for Matching Scoring Service's new ML admin surface
 * (/ml/config, /ml/train, /ml/model/status, /ml/model/versions - moved from src/api/ml.routes.ts,
 * that router now dead/unreachable once API Gateway routes those 4 paths there). Mirrors the trust
 * model every other Tier 0 service's /internal/* already documents: no JWT here, gated by network
 * boundary (API Gateway's proxy.ts already 404s /internal/* unconditionally; Matching Scoring
 * Service calls this directly via MONOLITH_INTERNAL_URL, never through the Gateway).
 *
 * Every handler is a thin wrapper around the EXACT activeModelType/setActiveModelType/
 * trainModelOnStartup/matching_model_config state in src/matching/services.ts - unchanged,
 * still the sole thing the monolith's own live-scoring engine reads for real production scoring.
 * Nothing here is new business logic; this endpoint exists only so Matching Scoring Service's
 * gateway-facing /ml/* routes have something real to delegate to.
 */
import { Router } from 'express';
import { db } from '../db.js';
import {
  activeModelType,
  isRetrainingInProgress,
  lastTrainingTimestamp,
  setActiveModelType,
  setRetrainingStatus,
  trainModelOnStartup,
} from '../matching/services.js';
import { getEnsembleHealth } from '../algorithms/ml-models.js';
import { publishRealtimeEvent } from '../realtimeBroadcast.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/model-config', (_req, res) => {
  res.json({ activeModelType, isRetrainingInProgress, lastTrainingTimestamp });
});

router.post('/model-config', async (req, res) => {
  const { activeModelType: newType } = req.body;
  if (!newType || !['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'].includes(newType)) {
    return res.status(400).json({ error: 'Invalid activeModelType' });
  }
  try {
    await setActiveModelType(newType);
    res.json({ activeModelType: newType, isRetrainingInProgress, lastTrainingTimestamp });
  } catch (error: any) {
    logger.error({ err: error.message }, '[internal/matching-scoring] Failed to persist active model type');
    res.status(500).json({ error: 'Failed to save model configuration: ' + error.message });
  }
});

router.post('/train', async (_req, res) => {
  setRetrainingStatus(true);
  await publishRealtimeEvent('model-training-started', {});
  try {
    await trainModelOnStartup();
    setRetrainingStatus(false);

    const health = await getEnsembleHealth();
    await publishRealtimeEvent('model-retrained', { trained: health?.ensembleTrained ?? false, sampleCount: health?.trainedSampleCount ?? 0 });

    res.json({
      success: true,
      activeModelType,
      isRetrainingInProgress,
      lastTrainingTimestamp,
      ensembleTrained: health?.ensembleTrained ?? false,
      trainedSampleCount: health?.trainedSampleCount ?? 0,
    });
  } catch (error: any) {
    setRetrainingStatus(false);
    res.status(500).json({ error: 'Failed to retrain: ' + error.message });
  }
});

router.get('/model-status', async (_req, res) => {
  const [health, swipes] = await Promise.all([getEnsembleHealth(), db.getAllSwipesUnscoped()]);
  res.json({
    ensemble_trained: health?.ensembleTrained ?? false,
    trained_sample_count: health?.trainedSampleCount ?? 0,
    total_swipes_available: swipes.length,
    last_trained: lastTrainingTimestamp,
    ml_service_reachable: health !== null,
  });
});

router.get('/model-versions', (_req, res) => {
  res.json([]);
});

export default router;
