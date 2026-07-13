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
} from '../services.js';
import { getEnsembleHealth } from '../algorithms/ml-models.js';
import { broadcastEvent } from '../realtime.js';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';

const router = Router();
router.use(requireAuth);

router.get('/ml/config', requireRole('recruiter', 'admin'), (req, res) => {
    res.json({
      activeModelType,
      isRetrainingInProgress,
      lastTrainingTimestamp
    });
});

router.post('/ml/config', requireRole('admin'), (req, res) => {
    const { activeModelType: newType } = req.body;
    if (newType && ['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'].includes(newType)) {
      setActiveModelType(newType);
      res.json({ activeModelType: newType, isRetrainingInProgress, lastTrainingTimestamp });
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
    const [health, swipes] = await Promise.all([getEnsembleHealth(), db.getSwipes()]);
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

export default router;
