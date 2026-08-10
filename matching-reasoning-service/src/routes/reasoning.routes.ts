/**
 * Internal, monolith-to-service endpoints for Matching Reasoning Service (Batch 26, Phase D Item 3).
 * Inverted direction from every other Tier 0 service's /internal/* API in this migration: there, a new
 * service calls the monolith; here, the monolith calls this service (its own
 * src/reasoningServiceShadow.ts, fire-and-forget, gated behind SHADOW_REASONING_ENABLED). Trusted
 * by network boundary, no JWT - same convention as every other /internal/* endpoint, direction
 * aside. This service has no other HTTP surface (no gateway routing - see README.md).
 *
 * Reasoning computation handlers run this service's own ported computeReasoningForCandidate/
 * computeReasoningForJob against its own dual-written skill_nodes/skill_edges mirror, stores the
 * result in its own reasoning_conclusions table, and returns it - so the monolith's shadow caller
 * can diff it against what the monolith's own (unchanged) computation just produced.
 *
 * Phase D Item 3: Career trajectory ownership - accepts a POST with a candidate's trajectory data
 * and stores it in this service's own career_trajectories table (making this service the owner,
 * not the monolith).
 */
import { Router } from 'express';
import { computeReasoningForCandidate, computeReasoningForJob } from '../matching/reasoning/computeReasoning.js';
import { replaceCareerTrajectory } from '../db.js';

const router = Router();

router.post('/compute-for-candidate', async (req, res) => {
  try {
    const { candidateId, skills, projectEntries } = req.body;
    if (typeof candidateId !== 'number') {
      return res.status(400).json({ error: 'candidateId is required' });
    }
    const conclusions = await computeReasoningForCandidate(candidateId, skills, projectEntries);
    res.json({ conclusions });
  } catch (error) {
    console.error('[internal] compute-for-candidate error:', error);
    res.status(500).json({ error: 'Failed to compute reasoning for candidate' });
  }
});

router.post('/compute-for-job', async (req, res) => {
  try {
    const { jobId, requiredSkills, optionalSkills } = req.body;
    if (typeof jobId !== 'number') {
      return res.status(400).json({ error: 'jobId is required' });
    }
    const conclusions = await computeReasoningForJob(jobId, requiredSkills, optionalSkills);
    res.json({ conclusions });
  } catch (error) {
    console.error('[internal] compute-for-job error:', error);
    res.status(500).json({ error: 'Failed to compute reasoning for job' });
  }
});

// Phase D Item 3: Career trajectory ownership
router.post('/career-trajectory/replace', async (req, res) => {
  try {
    const { candidateId, trajectory } = req.body;
    if (typeof candidateId !== 'number' || !trajectory) {
      return res.status(400).json({ error: 'candidateId and trajectory are required' });
    }
    const result = await replaceCareerTrajectory(candidateId, trajectory);
    res.json({ trajectory: result });
  } catch (error) {
    console.error('[internal] replace career trajectory error:', error);
    res.status(500).json({ error: 'Failed to replace career trajectory' });
  }
});

export default router;
