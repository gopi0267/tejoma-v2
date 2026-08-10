/**
 * Internal, monolith-to-service endpoint for Matching BGE Shadow Service (Batch 28). Same trust
 * model as every other /internal/* endpoint in this migration - no JWT, network-boundary trusted.
 * Called fire-and-forget from the monolith's swipe.routes.ts after every real match-scoring
 * response has already been sent (see that file's own comment: "never changes topCandidate/
 * scoredCandidates... silently no-ops if the BGE service isn't running").
 *
 * Computes the full shadow comparison and stores it directly in this service's own database - full
 * real ownership from day one, not a shadow-of-a-shadow (see migrations/001_initial_schema.up.sql's
 * header comment for why that's safe here specifically).
 */
import { Router } from 'express';
import { db } from '../db.js';
import { computeBgeShadowComparison } from '../matching/bgeShadowRetrieval.js';
import type { BgeCandidateInput, BgeJobInput } from '../types.js';

const router = Router();

router.post('/compare', async (req, res) => {
  try {
    const { companyId, job, existingRanked } = req.body as {
      companyId: number;
      job: BgeJobInput;
      existingRanked: Array<{ candidate: BgeCandidateInput; match_score: number }>;
    };
    if (typeof companyId !== 'number' || !job || !Array.isArray(existingRanked)) {
      return res.status(400).json({ error: 'companyId, job, and existingRanked[] are required' });
    }

    const result = await computeBgeShadowComparison(job, existingRanked);
    await db.insertBgeRetrievalShadowComparison({
      company_id: companyId,
      job_id: job.id,
      pool_size: result.poolSize,
      existing_ranking: result.existingRanking,
      bge_ranking: result.bgeRanking,
      top10_overlap_count: result.top10OverlapCount,
      top10_overlap_pct: result.top10OverlapPct,
      rank_correlation: result.rankCorrelation,
      bge_available: result.bgeAvailable,
      embed_latency_ms: result.embedLatencyMs,
      rerank_latency_ms: result.rerankLatencyMs,
    });

    res.json({ stored: true, bgeAvailable: result.bgeAvailable, poolSize: result.poolSize });
  } catch (error) {
    console.error('[internal] compare error:', error);
    res.status(500).json({ error: 'Failed to compute BGE shadow comparison' });
  }
});

export default router;
