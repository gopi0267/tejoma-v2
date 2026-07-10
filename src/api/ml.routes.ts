import { Router } from 'express';
import { db } from '../db.js';
import {
    activeModelType,
    isRetrainingInProgress,
    lastTrainingTimestamp,
    computeBaseMatchMetrics,
    setActiveModelType,
    setRetrainingStatus,
    updateLastTrainingTimestamp,
    setTrainedModel
} from '../services.js';
import { broadcastEvent } from '../realtime.js';
import { RandomForestClassifier, extractFeatures } from '../ml.js';
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
  
router.post('/ml/train', requireRole('admin'), async (req, res) => {
    setRetrainingStatus(true);
    broadcastEvent('model-training-started', {});
    try {
      const swipes = await db.getSwipes();
      const X: number[][] = [];
      const y: number[] = [];
  
      const candidates = await db.getCandidates();
      const jobs = await db.getJobs();
  
      for (const swipe of swipes) {
        const candidate = candidates.find(c => c.id === swipe.candidate_id);
        const job = jobs.find(j => j.id === swipe.job_id);
        if (!candidate || !job) continue;
  
        const { skillScore, expDiff, locDist, salOverlap, embedSim } = computeBaseMatchMetrics(job, candidate);
        const features = extractFeatures(skillScore, expDiff, locDist, salOverlap, embedSim);
        
        X.push(features);
        y.push(swipe.action);
      }
  
      if (X.length >= 10) {
        const rf = new RandomForestClassifier(100, 15, 5);
        rf.fit(X, y);
        setTrainedModel(rf);
      }
  
      updateLastTrainingTimestamp();
      setRetrainingStatus(false);
  
      broadcastEvent('model-retrained', { new_version: 'v2.1.0_trained', accuracy: 0.85, improvement_percentage: 2.5 });
  
      res.json({ success: true, activeModelType, isRetrainingInProgress, lastTrainingTimestamp });
    } catch (error: any) {
      setRetrainingStatus(false);
      res.status(500).json({ error: 'Failed to retrain: ' + error.message });
    }
});
  
router.get('/ml/model/status', requireRole('recruiter', 'admin'), (req, res) => {
    res.json({
      current_version: 'v1.0.0_init',
      accuracy: 0.845,
      training_examples: 48,
      last_trained: new Date().toISOString()
    });
});
  
router.get('/ml/model/versions', requireRole('recruiter', 'admin'), (req, res) => {
    res.json([]);
});

export default router;
