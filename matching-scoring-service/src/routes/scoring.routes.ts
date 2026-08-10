/**
 * Internal, monolith-to-service endpoints for Matching Scoring Service. Same trust model and
 * inverted-direction shape as matching-reasoning-service's reasoning.routes.ts: the monolith calls
 * this service (from src/matchingScoringServiceShadow.ts, fire-and-forget, gated behind
 * SHADOW_SCORING_ENABLED), never the other way around. No JWT - network-boundary trusted.
 *
 * Each handler runs this service's own ported calculateMatchScoresBatch/
 * calculateMatchScoresForJobsBatch against exactly the job/candidates/modelType the monolith
 * passes in the request body, stores the result in this service's own scoring_computations table,
 * and returns it - so the monolith's shadow caller can diff it against what its own (unchanged,
 * live) computation just produced for the same real request.
 */
import { Router } from 'express';
import { db } from '../db.js';
import { scoringComputationCount } from '../utils/metrics.js';
import { calculateMatchScoresBatch, calculateMatchScoresForJobsBatch, type ActiveModelType } from '../matching/services.js';
import type { Candidate, Job } from '../types.js';

const router = Router();

const VALID_MODEL_TYPES: ActiveModelType[] = ['heuristic', 'ml_tree', 'random_forest', 'hybrid_weighted'];

function resolveModelType(input: unknown): ActiveModelType {
  return typeof input === 'string' && (VALID_MODEL_TYPES as string[]).includes(input) ? (input as ActiveModelType) : 'random_forest';
}

router.post('/score/candidates-batch', async (req, res) => {
  try {
    const { job, candidates, modelType } = req.body as { job: Job; candidates: Candidate[]; modelType?: string };
    if (!job || !Array.isArray(candidates)) {
      return res.status(400).json({ error: 'job and candidates[] are required' });
    }

    const resolvedModelType = resolveModelType(modelType);
    const results = await calculateMatchScoresBatch(job, candidates, resolvedModelType);

    scoringComputationCount.inc({ request_kind: 'candidates_batch' });
    await db.insertScoringComputation({
      request_kind: 'candidates_batch',
      job_id: job.id,
      subject_count: candidates.length,
      model_type: resolvedModelType,
      results,
    });

    res.json({ results });
  } catch (error) {
    console.error('[internal] score/candidates-batch error:', error);
    res.status(500).json({ error: 'Failed to compute candidate scores' });
  }
});

router.post('/score/jobs-batch', async (req, res) => {
  try {
    const { candidate, jobs, modelType } = req.body as { candidate: Candidate; jobs: Job[]; modelType?: string };
    if (!candidate || !Array.isArray(jobs)) {
      return res.status(400).json({ error: 'candidate and jobs[] are required' });
    }

    const resolvedModelType = resolveModelType(modelType);
    const results = await calculateMatchScoresForJobsBatch(candidate, jobs, resolvedModelType);

    scoringComputationCount.inc({ request_kind: 'jobs_batch' });
    await db.insertScoringComputation({
      request_kind: 'jobs_batch',
      job_id: jobs[0]?.id ?? 0,
      subject_count: jobs.length,
      model_type: resolvedModelType,
      results,
    });

    res.json({ results });
  } catch (error) {
    console.error('[internal] score/jobs-batch error:', error);
    res.status(500).json({ error: 'Failed to compute job scores' });
  }
});

export default router;
