/**
 * Ported from the monolith's src/matching/learningToRank.ts - Enterprise AI Matching
 * Architecture, Phase 3 Learning-to-Rank. Same orchestration logic byte-for-byte; the only
 * changes are where data comes from: db.getAllSwipesUnscoped/getAllCandidatesUnscoped/
 * getAllJobsUnscoped (local reads) are now assembled by trainingDataClient.getTrainingData()
 * from the services that own each dataset (matching-decision-service /internal/swipes/all,
 * candidate-core-service /internal/candidates/all, job-service /internal/jobs/all), and
 * calculateMatchScoresBatch is reached through matching-scoring-service, which owns that engine,
 * via matchingScoringServiceClient.scoreBatchFeatureVectors. db.saveLtrModelVersion is unchanged - this service owns ltr_model_versions
 * directly. trainRanking/getRankerHealth (this service's own algorithms/ltr-models.ts) call the
 * Python Learning-to-Rank service directly, exactly as the monolith's copy always did.
 *
 * Fully parallel/isolated orchestrator: trains the grouped XGBRanker/LGBMRanker capability
 * alongside the production classification ensemble (which stays on the monolith) - does NOT
 * replace or modify that path. Every trained run is recorded with is_active: false.
 *
 * Relevance grade: swipe.action (0 / 0.5 / 1) is mapped onto an ORDINAL INTEGER scale - reject=0,
 * save=1, accept=2 - LightGBM's lambdarank objective raises "label should be int type" on a raw
 * 0.5. Grouped by job_id (the rank query), matching XGBRanker/LGBMRanker's group API.
 */
import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { getTrainingData } from '../services/trainingDataClient.js';
import { scoreBatchFeatureVectors } from '../services/matchingScoringServiceClient.js';
import { trainRanking, type RankingGroup } from '../algorithms/ltr-models.js';
import type { OpaqueCandidate, Swipe } from '../types.js';

const MIN_GROUP_SIZE = 2;

const RELEVANCE_GRADE: Record<string, number> = { '0': 0, '0.5': 1, '1': 2 };

export interface LearningToRankTrainingReport {
  trained: boolean;
  exampleCount: number;
  groupCount: number;
  reason?: string;
}

export async function trainLearningToRank(): Promise<LearningToRankTrainingReport> {
  const { swipes, candidates, jobs } = await getTrainingData();
  if (swipes.length === 0) {
    return { trained: false, exampleCount: 0, groupCount: 0, reason: 'No swipes available for Learning-to-Rank training' };
  }

  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const swipesByJob = new Map<number, Swipe[]>();
  for (const swipe of swipes) {
    if (swipe.action !== 0 && swipe.action !== 0.5 && swipe.action !== 1) continue;
    const list = swipesByJob.get(swipe.job_id) ?? [];
    list.push(swipe);
    swipesByJob.set(swipe.job_id, list);
  }

  const groups: RankingGroup[] = [];
  for (const [jobId, jobSwipes] of swipesByJob) {
    if (jobSwipes.length < MIN_GROUP_SIZE) continue;
    const job = jobById.get(jobId);
    if (!job) continue;

    const groupCandidates: OpaqueCandidate[] = [];
    const relevanceByIndex: number[] = [];
    for (const swipe of jobSwipes) {
      const candidate = candidateById.get(swipe.candidate_id);
      if (!candidate) continue;
      groupCandidates.push(candidate);
      relevanceByIndex.push(RELEVANCE_GRADE[String(swipe.action)]);
    }
    if (groupCandidates.length < MIN_GROUP_SIZE) continue;

    // Aligned by candidate id, NOT by position: matching-scoring-service's
    // rank-candidates-for-job sorts its output by match_score, whereas the monolith's scoreBatch
    // preserved input order. Zipping the sorted array against relevanceByIndex would pair each
    // grade with the wrong candidate's feature vector and silently train on mislabelled data.
    const featureVectorByCandidateId = await scoreBatchFeatureVectors(job, groupCandidates);
    const samples = groupCandidates
      .map((candidate, i) => ({ features: featureVectorByCandidateId.get(candidate.id), relevance: relevanceByIndex[i] }))
      .filter((s): s is { features: number[]; relevance: number } => Array.isArray(s.features));

    if (samples.length >= MIN_GROUP_SIZE) {
      groups.push({ jobId, samples });
    }
  }

  if (groups.length === 0) {
    return { trained: false, exampleCount: 0, groupCount: 0, reason: 'No job had enough swipes (>= 2, with resolvable candidate data) to form a rank group' };
  }

  const result = await trainRanking(groups);
  if (!result) {
    return { trained: false, exampleCount: 0, groupCount: groups.length, reason: 'Matching ML service unavailable' };
  }

  if (result.trained) {
    await db.saveLtrModelVersion({
      version: `ltr-${new Date().toISOString()}`,
      algorithm: 'xgboost_ranker+lightgbm_ranker',
      training_examples: result.exampleCount,
      training_groups: result.groupCount,
      ndcg_at_10: null,
      is_active: false,
    });
    logger.info(
      { exampleCount: result.exampleCount, groupCount: result.groupCount },
      'Learning-to-Rank ensemble (XGBRanker + LGBMRanker) trained successfully (isolated - not wired into live scoring)'
    );
  } else {
    logger.warn({ reason: result.reason }, 'Learning-to-Rank training skipped');
  }

  return result;
}
