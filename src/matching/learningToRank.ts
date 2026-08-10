// Enterprise AI Matching Architecture, Phase 3 - Learning-to-Rank.
//
// Fully parallel/isolated orchestrator: trains the new grouped XGBRanker/LGBMRanker capability
// (python-services/matching-ml-service/ranker.py) alongside the production RandomForest/XGBoost/
// LightGBM CLASSIFICATION ensemble (services.ts's trainModelOnStartup) - it does NOT replace or
// modify that path, and nothing in this module is called by matchingApi.ts/services.ts's live
// scoring. The only caller is the new isolated admin route (POST /api/ml/train/ranking, see
// src/api/ml.routes.ts) until a future phase deliberately, explicitly decides to wire a
// validated ranker into live scoring - a config/read-path change at that point, not a rewrite of
// this module. Every trained run is recorded via db.saveLtrModelVersion with is_active: false.
//
// Reuses calculateMatchScoresBatch's feature_vector output (Phase 3's Feature Store addition) as
// the single source of truth for the 8-dimensional feature vector, instead of duplicating
// buildFeatureVector's private assembly logic here.
//
// Relevance grade: swipe.action (0 / 0.5 / 1) is mapped onto an ORDINAL INTEGER scale - reject=0,
// save=1, accept=2 (RELEVANCE_GRADE below) - rather than used directly as a float. Discovered
// necessary the hard way: LightGBM's lambdarank objective raises "label should be int type" and
// crashes the whole training run when handed a raw 0.5. This is still a more natural fit for
// Learning-to-Rank than the classifier's binary accept/reject: the "save" signal that the
// classifier can only approximate via a down-weighted binary label (see feedbackSignals.ts) gets
// its own distinct, ordered relevance grade here, no approximation needed - just an integer
// grade instead of a fractional one. Grouped by job_id (the rank query), matching
// XGBRanker/LGBMRanker's group API.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { calculateMatchScoresBatch } from './services.js';
import { trainRanking, type RankingGroup } from '../algorithms/ltr-models.js';
import type { Candidate, Swipe } from '../types.js';

// A rank group of 1 candidate has no relative order to learn from - mirrors ranker.py's own
// MIN_GROUP_SIZE, filtered here too so a mostly-empty payload is never sent over the wire.
const MIN_GROUP_SIZE = 2;

// swipes.action (0 / 0.5 / 1) -> integer relevance grade for the ranker (see module doc above).
const RELEVANCE_GRADE: Record<string, number> = { '0': 0, '0.5': 1, '1': 2 };

export interface LearningToRankTrainingReport {
  trained: boolean;
  exampleCount: number;
  groupCount: number;
  reason?: string;
}

export async function trainLearningToRank(): Promise<LearningToRankTrainingReport> {
  // Training is pooled across every company, same as trainModelOnStartup (see
  // db.getAllSwipesUnscoped's comment) - jobs.id is globally unique regardless of company, so
  // grouping by job_id here never mixes two different companies' candidates into one rank group.
  const swipes = await db.getAllSwipesUnscoped();
  if (swipes.length === 0) {
    return { trained: false, exampleCount: 0, groupCount: 0, reason: 'No swipes available for Learning-to-Rank training' };
  }

  const candidates = await db.getAllCandidatesUnscoped();
  const jobs = await db.getAllJobsUnscoped();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const swipesByJob = new Map<number, Swipe[]>();
  for (const swipe of swipes) {
    if (swipe.action !== 0 && swipe.action !== 0.5 && swipe.action !== 1) continue; // never guess a relevance grade
    const list = swipesByJob.get(swipe.job_id) ?? [];
    list.push(swipe);
    swipesByJob.set(swipe.job_id, list);
  }

  const groups: RankingGroup[] = [];
  for (const [jobId, jobSwipes] of swipesByJob) {
    if (jobSwipes.length < MIN_GROUP_SIZE) continue;
    const job = jobById.get(jobId);
    if (!job) continue;

    const groupCandidates: Candidate[] = [];
    const relevanceByIndex: number[] = [];
    for (const swipe of jobSwipes) {
      const candidate = candidateById.get(swipe.candidate_id);
      if (!candidate) continue;
      groupCandidates.push(candidate);
      relevanceByIndex.push(RELEVANCE_GRADE[String(swipe.action)]);
    }
    if (groupCandidates.length < MIN_GROUP_SIZE) continue;

    const scored = await calculateMatchScoresBatch(job, groupCandidates, { skipGeminiSummary: true });
    const samples = scored
      .map((s, i) => ({ features: s.feature_vector, relevance: relevanceByIndex[i] }))
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
      algorithm: 'xgboost_ranker+lightgbm_ranker', // trained jointly as one ensemble, same as ensemble.py's classifier
      training_examples: result.exampleCount,
      training_groups: result.groupCount,
      ndcg_at_10: null, // measured separately by the Evaluation Framework (src/matching/evaluation.ts), not this training call
      is_active: false, // isolated - never marked active/wired into live scoring this phase
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
