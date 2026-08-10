/**
 * Internal API for Dynamic Weighting / Explainable Matching Service (Batch 33). Unlike every
 * other Tier 0 service in this migration, there is no shadow client and no trigger to swap on the
 * monolith side - like Role Intelligence Service (Batch 29), nothing anywhere in the monolith
 * calls the functions this service ports (confirmed via grep - see package.json's own
 * description). These endpoints exist, are fully tested, and are ready for whichever future
 * caller needs them.
 *
 * Every endpoint takes its full input directly in the request body - this service has no
 * MONOLITH_INTERNAL_URL and needs nothing back from a caller mid-request.
 */
import { Router } from 'express';
import { resolveSkillTiers, computeSeniorityAdjustedWeights, computeDynamicSkillScore } from '../matching/dynamicWeighting.js';
import { buildMatchExplanation } from '../matching/explainability.js';
import { hybridRetrieveCandidates } from '../matching/retrieval.js';
import type { DynamicWeightingJob, ResolvedSkillTiers, DynamicSkillScoreResult, DynamicWeights, ConfidenceProfile } from '../types.js';

const router = Router();

router.post('/resolve-skill-tiers', async (req, res) => {
  try {
    const job = req.body.job as DynamicWeightingJob;
    if (!job) return res.status(400).json({ error: 'job is required' });
    const tiers = await resolveSkillTiers(job);
    res.json({ tiers });
  } catch (error) {
    console.error('[internal] resolve-skill-tiers error:', error);
    res.status(500).json({ error: 'Failed to resolve skill tiers' });
  }
});

router.post('/compute-seniority-weights', (req, res) => {
  try {
    const job = req.body.job as DynamicWeightingJob;
    if (!job) return res.status(400).json({ error: 'job is required' });
    const weights = computeSeniorityAdjustedWeights(job);
    res.json({ weights });
  } catch (error) {
    console.error('[internal] compute-seniority-weights error:', error);
    res.status(500).json({ error: 'Failed to compute seniority-adjusted weights' });
  }
});

router.post('/compute-dynamic-skill-score', async (req, res) => {
  try {
    const { candidateSkills, tiers } = req.body as { candidateSkills: string[]; tiers: ResolvedSkillTiers };
    if (!Array.isArray(candidateSkills) || !tiers) {
      return res.status(400).json({ error: 'candidateSkills and tiers are required' });
    }
    const result = await computeDynamicSkillScore(candidateSkills, tiers);
    res.json({ result });
  } catch (error) {
    console.error('[internal] compute-dynamic-skill-score error:', error);
    res.status(500).json({ error: 'Failed to compute dynamic skill score' });
  }
});

router.post('/build-explanation', (req, res) => {
  try {
    const { skillResult, weights, confidenceProfile } = req.body as { skillResult: DynamicSkillScoreResult; weights: DynamicWeights; confidenceProfile?: ConfidenceProfile | null };
    if (!skillResult || !weights) {
      return res.status(400).json({ error: 'skillResult and weights are required' });
    }
    const explanation = buildMatchExplanation({ skillResult, weights, confidenceProfile });
    res.json({ explanation });
  } catch (error) {
    console.error('[internal] build-explanation error:', error);
    res.status(500).json({ error: 'Failed to build match explanation' });
  }
});

router.post('/hybrid-retrieve', async (req, res) => {
  try {
    const { job, candidates, limit } = req.body;
    if (!job || !Array.isArray(candidates)) {
      return res.status(400).json({ error: 'job and candidates are required' });
    }
    const results = await hybridRetrieveCandidates(job, candidates, { limit });
    res.json({ results });
  } catch (error) {
    console.error('[internal] hybrid-retrieve error:', error);
    res.status(500).json({ error: 'Failed to run hybrid retrieval' });
  }
});

export default router;
