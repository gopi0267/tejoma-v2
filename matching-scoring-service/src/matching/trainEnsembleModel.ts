/**
 * Classification-ensemble training (RandomForest + XGBoost + LightGBM), ported from the
 * monolith's src/matching/services.ts trainModelOnStartup as the FINAL business-critical
 * monolith dependency removed.
 *
 * The orchestration is byte-for-byte the monolith's. The only change is where data comes from:
 * db.getAllSwipesUnscoped / getAllCandidatesUnscoped / getAllJobsUnscoped /
 * getAllApplicationStatusLinkedToCandidatesUnscoped (four local reads against the shared monolith
 * database) became one trainingDataClient.getTrainingData() fan-out to the services that own each
 * dataset. Everything after that - resolveTrainingSamples, computeMatchFeatures,
 * computeBertCosineScore, buildFeatureVector, trainEnsemble - already lived in this service and is
 * called unchanged.
 *
 * Deliberately NOT changed while moving it:
 *   - the label taxonomy (feedbackSignals.resolveTrainingSamples, ported verbatim),
 *   - per-sample weights,
 *   - the "no swipes" / "no valid labeled samples" early returns and their log messages,
 *   - updateLastTrainingTimestamp() firing regardless of training outcome.
 * A behavioural change here would silently produce a differently-trained model rather than a
 * visible error, so the port keeps the semantics identical and only relocates the reads.
 */
import { getTrainingData } from '../services/trainingDataClient.js';
import { resolveTrainingSamples } from './feedbackSignals.js';
import { computeMatchFeatures, buildFeatureVector, computeBertCosineScore, updateLastTrainingTimestamp } from './services.js';
import { trainEnsemble, type TrainSample } from '../algorithms/ml-models.js';
import { logger } from '../utils/logger.js';

export interface TrainEnsembleReport {
  trained: boolean;
  sampleCount: number;
  /** Per-model cross-validation accuracy, exactly as the ML service returns it. */
  cvAccuracy?: { randomForest: number; xgboost: number; lightgbm: number } | null;
  statusCorroboratedSamples?: number;
  reason?: string;
}

export async function trainClassificationEnsemble(): Promise<TrainEnsembleReport> {
  const { swipes, candidates, jobs, applicationStatusByCandidateJob } = await getTrainingData();

  if (swipes.length === 0) {
    logger.warn('No swipes available for ML training.');
    return { trained: false, sampleCount: 0, reason: 'No swipes available for ML training' };
  }

  const candidateById = new Map<number, any>(candidates.map((c: any) => [c.id, c]));
  const jobById = new Map<number, any>(jobs.map((j: any) => [j.id, j]));

  const weightedSamples = resolveTrainingSamples(swipes as any, applicationStatusByCandidateJob, (swipe: any) => {
    const candidate = candidateById.get(swipe.candidate_id);
    const job = jobById.get(swipe.job_id);
    if (!candidate || !job) return null;
    const features = computeMatchFeatures(job, candidate);
    const bertScore = computeBertCosineScore(candidate, job);
    return buildFeatureVector(features, bertScore);
  });

  if (weightedSamples.length === 0) {
    logger.warn('No valid labeled samples (accept/reject/save swipes) available for ML training.');
    return { trained: false, sampleCount: 0, reason: 'No valid labeled samples available for ML training' };
  }

  const samples: TrainSample[] = weightedSamples.map((s) => ({ features: s.features, label: s.label, weight: s.weight }));
  const statusCorroboratedCount = weightedSamples.filter((s) => s.sources.includes('application_status_corroboration')).length;

  const result = await trainEnsemble(samples);
  await updateLastTrainingTimestamp();

  if (result?.trained) {
    logger.info(
      { sampleCount: result.sampleCount, cvAccuracy: result.cvAccuracy, statusCorroboratedSamples: statusCorroboratedCount },
      'Matching ensemble (RandomForest + XGBoost + LightGBM) trained successfully'
    );
    return {
      trained: true,
      sampleCount: result.sampleCount,
      cvAccuracy: result.cvAccuracy ?? null,
      statusCorroboratedSamples: statusCorroboratedCount,
    };
  }

  logger.warn({ reason: result?.reason ?? 'ML service unavailable' }, 'Matching ensemble training skipped');
  return {
    trained: false,
    sampleCount: samples.length,
    statusCorroboratedSamples: statusCorroboratedCount,
    reason: result?.reason ?? 'ML service unavailable',
  };
}
