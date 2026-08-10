// Ported from the monolith's src/matching/bgeShadowRetrieval.ts (Batch 28) - every pure/compute
// function byte-identical. logBgeShadowComparisonInBackground is NOT ported (this service has no
// same-process background-call trigger of its own - it's invoked synchronously by
// routes/internal.routes.ts, itself called fire-and-forget by the monolith's swipe.routes.ts).
//
// BGE-M3 + BGE-Reranker-v2-m3 retrieval shadow comparison. SHADOW MODE ONLY - never affects which
// candidates a recruiter sees or their order. Compares the existing live ranking (BM25 + MiniLM
// hybrid retrieval / dynamic weighting, entirely unchanged, computed by the monolith and passed in
// via the request body) against what a BGE-M3 dense retrieval + BGE-Reranker-v2-m3 cross-encoder
// pass over the SAME pool would have produced.
//
// Reranking is capped to the top 20 candidates from the dense-retrieval step, not the full pool -
// reranking every candidate would multiply the already-slow per-pair CPU cost for no benefit
// beyond what a shortlist needs.

import { cosineSimilarity } from '../utils/vectorMath.js';
import { embedWithBge, embedBatchWithBge, rerankWithBge, isBgeServiceAvailable } from '../services/bgeRetrievalClient.js';
import type { BgeCandidateInput, BgeJobInput, RankingEntry } from '../types.js';

const RERANK_TOP_N = 20;
const OVERLAP_K = 10;

export interface OverlapResult {
  count: number;
  pct: number;
}

// Pure - overlap between the top-k of two rankings. Denominator is min(k, both list lengths) so
// a short pool never reports a misleadingly low percentage.
export function computeTopKOverlap(existingIds: number[], bgeIds: number[], k: number): OverlapResult {
  const existingTopK = new Set(existingIds.slice(0, k));
  const bgeTopK = bgeIds.slice(0, k);
  const count = bgeTopK.filter((id) => existingTopK.has(id)).length;
  const denom = Math.min(k, existingIds.length, bgeIds.length);
  return { count, pct: denom > 0 ? Number(((count / denom) * 100).toFixed(2)) : 0 };
}

// Pure - standard Spearman rank correlation, computed over the INTERSECTION of both rankings
// (a candidate reranking dropped or a dense-retrieval-only candidate added would otherwise have
// no comparable rank in the other list). Null with fewer than 2 shared candidates - not enough
// to say anything about correlation.
export function computeRankCorrelation(existingIds: number[], bgeIds: number[]): number | null {
  const existingRank = new Map(existingIds.map((id, i) => [id, i]));
  const bgeRank = new Map(bgeIds.map((id, i) => [id, i]));
  const shared = existingIds.filter((id) => bgeRank.has(id));
  const n = shared.length;
  if (n < 2) return null;

  const dSquaredSum = shared.reduce((sum, id) => {
    const d = existingRank.get(id)! - bgeRank.get(id)!;
    return sum + d * d;
  }, 0);
  const rho = 1 - (6 * dSquaredSum) / (n * (n * n - 1));
  return Number(rho.toFixed(4));
}

function candidateText(candidate: BgeCandidateInput): string {
  const parts = [candidate.current_job_title, (candidate.skills || []).join(', '), candidate.resume_summary, candidate.projects];
  return parts.filter((p) => p && String(p).trim()).join('. ').slice(0, 5000);
}

function jobText(job: BgeJobInput): string {
  const parts = [job.title, job.description, (job.required_skills || []).join(', ')];
  return parts.filter((p) => p && String(p).trim()).join('. ').slice(0, 5000);
}

export interface BgeShadowComparisonResult {
  poolSize: number;
  existingRanking: RankingEntry[];
  bgeRanking: RankingEntry[] | null;
  top10OverlapCount: number | null;
  top10OverlapPct: number | null;
  rankCorrelation: number | null;
  bgeAvailable: boolean;
  embedLatencyMs: number | null;
  rerankLatencyMs: number | null;
}

const unavailableResult = (poolSize: number, existingRanking: RankingEntry[], embedLatencyMs: number | null = null): BgeShadowComparisonResult => ({
  poolSize,
  existingRanking,
  bgeRanking: null,
  top10OverlapCount: null,
  top10OverlapPct: null,
  rankCorrelation: null,
  bgeAvailable: false,
  embedLatencyMs,
  rerankLatencyMs: null,
});

// Orchestration - never throws (a network/timeout failure at any step falls back to reporting
// "BGE unavailable" for this comparison, exactly like every other shadow signal in this codebase).
export async function computeBgeShadowComparison(job: BgeJobInput, existingRanked: Array<{ candidate: BgeCandidateInput; match_score: number }>): Promise<BgeShadowComparisonResult> {
  const existingRanking: RankingEntry[] = existingRanked.map((r) => ({ candidateId: r.candidate.id, score: r.match_score }));
  const poolSize = existingRanked.length;
  if (poolSize === 0) return unavailableResult(poolSize, existingRanking);

  const available = await isBgeServiceAvailable();
  if (!available) return unavailableResult(poolSize, existingRanking);

  const jText = jobText(job);
  const candidateTexts = existingRanked.map((r) => candidateText(r.candidate));

  const embedStart = Date.now();
  const [jobEmbedding, candidateEmbeddings] = await Promise.all([embedWithBge(jText), embedBatchWithBge(candidateTexts)]);
  const embedLatencyMs = Date.now() - embedStart;
  if (!jobEmbedding || !candidateEmbeddings) return unavailableResult(poolSize, existingRanking, embedLatencyMs);

  const cosineRanked = existingRanked
    .map((r, i) => ({ candidateId: r.candidate.id, score: candidateEmbeddings[i] ? cosineSimilarity(jobEmbedding, candidateEmbeddings[i]) : 0 }))
    .sort((a, b) => b.score - a.score);

  const toRerank = cosineRanked.slice(0, Math.min(RERANK_TOP_N, cosineRanked.length));
  const candidateTextById = new Map(existingRanked.map((r) => [r.candidate.id, candidateText(r.candidate)]));
  const rerankTexts = toRerank.map((r) => candidateTextById.get(r.candidateId) ?? '');

  const rerankStart = Date.now();
  const rerankScores = await rerankWithBge(jText, rerankTexts);
  const rerankLatencyMs = rerankScores ? Date.now() - rerankStart : null;

  const bgeRanking: RankingEntry[] = rerankScores
    ? toRerank.map((r, i) => ({ candidateId: r.candidateId, score: rerankScores[i] })).sort((a, b) => b.score - a.score)
    : cosineRanked;

  const existingIds = existingRanking.map((r) => r.candidateId);
  const bgeIds = bgeRanking.map((r) => r.candidateId);
  const overlap = computeTopKOverlap(existingIds, bgeIds, OVERLAP_K);

  return {
    poolSize,
    existingRanking,
    bgeRanking,
    top10OverlapCount: overlap.count,
    top10OverlapPct: overlap.pct,
    rankCorrelation: computeRankCorrelation(existingIds, bgeIds),
    bgeAvailable: true,
    embedLatencyMs,
    rerankLatencyMs,
  };
}
