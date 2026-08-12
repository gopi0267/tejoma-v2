/**
 * Ported from the monolith's src/matching/evaluation.ts - Enterprise AI Matching Architecture,
 * Phase 3 Evaluation Framework. Every metric formula is byte-identical to the monolith's original;
 * the only change is where the swipe data comes from - db.getSwipesForEvaluation(companyId) (a
 * local DB read against this database's own copy of swipes) became
 * monolithClient.getSwipesForEvaluation(companyId) (a proxy call), since swipes remain
 * monolith-owned. saveEvaluationRun/getEvaluationRuns are unchanged local DB calls - this service
 * owns match_evaluation_runs directly.
 *
 * Real, standard information-retrieval ranking metrics (NDCG@K, MAP@K, MRR, Precision@K,
 * Recall@K), computed from swipes.match_score (the predicted rank, captured at decision time) +
 * swipes.action (0/0.5/1, graded ground-truth relevance) grouped by job_id - not a synthetic or
 * assumed dataset. "Relevant" (for Precision@K/Recall@K/MRR) is action > 0 - a save (0.5) counts
 * as relevant alongside a full accept (1). NDCG@K uses the full graded relevance (0/0.5/1)
 * directly.
 */
import { db } from '../db.js';
import { getSwipesForEvaluation } from '../services/matchingDecisionServiceClient.js';
import type { MatchEvaluationRun, Swipe } from '../types.js';

export const DEFAULT_K = 10;
const THIN_DATA_JOB_THRESHOLD = 5;
const THIN_DATA_SWIPE_THRESHOLD = 20;

const isRelevant = (relevance: number): boolean => relevance > 0;

// ==================== PURE METRIC FUNCTIONS (no DB/network dependency) ====================

function dcgAtK(relevances: number[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i++) {
    dcg += (Math.pow(2, relevances[i]) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(rankedRelevances: number[], k: number): number {
  const dcg = dcgAtK(rankedRelevances, k);
  const ideal = [...rankedRelevances].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function precisionAtK(rankedRelevances: number[], k: number): number {
  const top = rankedRelevances.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter(isRelevant).length / top.length;
}

export function recallAtK(rankedRelevances: number[], k: number): number {
  const totalRelevant = rankedRelevances.filter(isRelevant).length;
  if (totalRelevant === 0) return 0;
  const relevantInTop = rankedRelevances.slice(0, k).filter(isRelevant).length;
  return relevantInTop / totalRelevant;
}

export function reciprocalRank(rankedRelevances: number[]): number {
  const idx = rankedRelevances.findIndex(isRelevant);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

export function averagePrecisionAtK(rankedRelevances: number[], k: number): number {
  const totalRelevant = rankedRelevances.filter(isRelevant).length;
  if (totalRelevant === 0) return 0;
  const top = rankedRelevances.slice(0, k);
  let sum = 0;
  let relevantSoFar = 0;
  for (let i = 0; i < top.length; i++) {
    if (isRelevant(top[i])) {
      relevantSoFar += 1;
      sum += relevantSoFar / (i + 1);
    }
  }
  return sum / Math.min(totalRelevant, k);
}

// ==================== CROSS-QUERY AGGREGATION (still pure) ====================

export interface QueryEvaluation {
  jobId: number;
  rankedRelevances: number[];
}

export interface EvaluationMetrics {
  ndcgAtK: number;
  mapAtK: number;
  mrr: number;
  precisionAtK: number;
  recallAtK: number;
  k: number;
  jobsEvaluated: number;
  swipesEvaluated: number;
}

export function evaluateQueries(queries: QueryEvaluation[], k: number): EvaluationMetrics {
  const usable = queries.filter((q) => q.rankedRelevances.length > 0);
  if (usable.length === 0) {
    return { ndcgAtK: 0, mapAtK: 0, mrr: 0, precisionAtK: 0, recallAtK: 0, k, jobsEvaluated: 0, swipesEvaluated: 0 };
  }

  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  return {
    ndcgAtK: avg(usable.map((q) => ndcgAtK(q.rankedRelevances, k))),
    mapAtK: avg(usable.map((q) => averagePrecisionAtK(q.rankedRelevances, k))),
    mrr: avg(usable.map((q) => reciprocalRank(q.rankedRelevances))),
    precisionAtK: avg(usable.map((q) => precisionAtK(q.rankedRelevances, k))),
    recallAtK: avg(usable.map((q) => recallAtK(q.rankedRelevances, k))),
    k,
    jobsEvaluated: usable.length,
    swipesEvaluated: usable.reduce((sum, q) => sum + q.rankedRelevances.length, 0),
  };
}

// ==================== REAL-DATA ORCHESTRATOR ====================

export interface EvaluationResult {
  metrics: EvaluationMetrics;
  dataVolumeNote: string;
}

export async function evaluateFromSwipes(companyId: number, k: number = DEFAULT_K): Promise<EvaluationResult> {
  const { swipes } = await getSwipesForEvaluation(companyId);

  const byJob = new Map<number, Swipe[]>();
  for (const swipe of swipes) {
    if (typeof swipe.match_score !== 'number') continue;
    const list = byJob.get(swipe.job_id) ?? [];
    list.push(swipe);
    byJob.set(swipe.job_id, list);
  }

  const queries: QueryEvaluation[] = [];
  for (const [jobId, jobSwipes] of byJob) {
    if (jobSwipes.length < 2) continue;
    const ordered = [...jobSwipes].sort((a, b) => b.match_score - a.match_score);
    queries.push({ jobId, rankedRelevances: ordered.map((s) => Number(s.action)) });
  }

  const effectiveK = Math.max(1, k);
  const metrics = evaluateQueries(queries, effectiveK);

  const notes: string[] = [];
  if (metrics.jobsEvaluated < THIN_DATA_JOB_THRESHOLD) {
    notes.push(
      `Only ${metrics.jobsEvaluated} job(s) had enough swipes (>= 2) to evaluate a ranking - below ${THIN_DATA_JOB_THRESHOLD}, these metrics are directional only, not statistically reliable.`
    );
  }
  if (metrics.swipesEvaluated < THIN_DATA_SWIPE_THRESHOLD) {
    notes.push(
      `Only ${metrics.swipesEvaluated} total swipe(s) contributed to this evaluation - below ${THIN_DATA_SWIPE_THRESHOLD}.`
    );
  }
  if (notes.length === 0) {
    notes.push('Evaluated on real swipe history with no thin-data caveats at the current thresholds.');
  }

  return { metrics, dataVolumeNote: notes.join(' ') };
}

export async function runAndSaveEvaluation(companyId: number, k: number = DEFAULT_K): Promise<MatchEvaluationRun | null> {
  const { metrics, dataVolumeNote } = await evaluateFromSwipes(companyId, k);
  return db.saveEvaluationRun({
    company_id: companyId,
    jobs_evaluated: metrics.jobsEvaluated,
    swipes_evaluated: metrics.swipesEvaluated,
    k: metrics.k,
    ndcg_at_k: metrics.jobsEvaluated > 0 ? metrics.ndcgAtK : null,
    map_at_k: metrics.jobsEvaluated > 0 ? metrics.mapAtK : null,
    mrr: metrics.jobsEvaluated > 0 ? metrics.mrr : null,
    precision_at_k: metrics.jobsEvaluated > 0 ? metrics.precisionAtK : null,
    recall_at_k: metrics.jobsEvaluated > 0 ? metrics.recallAtK : null,
    data_volume_note: dataVolumeNote,
  });
}
