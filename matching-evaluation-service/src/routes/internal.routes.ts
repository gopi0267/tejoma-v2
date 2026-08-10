/**
 * Internal, monolith-to-service endpoints for the shadow-weighting cluster (Batch 31) and
 * reasoning conclusions ownership (Phase D Item 4). Same inverted direction as Batch 26/30's
 * shadow-comparison endpoints: the monolith calls this service (via src/matchingEvaluationServiceShadow.ts
 * for shadow-weighting, fire-and-forget, gated behind SHADOW_MATCHING_EVALUATION_ENABLED; via
 * computeReasoningForCandidate/computeReasoningForJob, gated behind REASONING_CONCLUSIONS_CUTOVER_ENABLED).
 * Trusted by network boundary, no JWT - unlike this service's other routes (evaluation.routes.ts,
 * shadowAnalytics.routes.ts), which are real recruiter-facing endpoints behind requireAuth.
 *
 * For shadow-weighting: Runs this service's own ported computeShadowWeighting against its own
 * dual-written mirrors (skill_nodes/role_profiles/career_trajectories/reasoning_conclusions),
 * stores the result in its own owned shadow_weighting_computations table, and returns it so the
 * monolith's shadow caller can diff it against what the monolith's own (unchanged) shadowScoring.ts
 * just computed.
 *
 * For reasoning conclusions (Phase D Item 4): accepts a POST with conclusions to replace for a
 * subject, writes them to the service's own reasoning_conclusions table (making this service the
 * owner, not the monolith).
 */
import { Router } from 'express';
import { computeShadowWeighting } from '../matching/shadowScoring.js';
import { replaceReasoningConclusions } from '../db.js';

const router = Router();

router.post('/compute-shadow-weighting', async (req, res) => {
  try {
    const { companyId, candidate, job, matchedSkills, baseScore, decisionAction } = req.body;
    if (typeof companyId !== 'number' || !candidate || !job || !Array.isArray(matchedSkills) || typeof baseScore !== 'number') {
      return res.status(400).json({ error: 'companyId, candidate, job, matchedSkills, and baseScore are required' });
    }
    const computation = await computeShadowWeighting(companyId, candidate, job, matchedSkills, baseScore, decisionAction ?? null);
    res.json({ computation });
  } catch (error) {
    console.error('[internal] compute-shadow-weighting error:', error);
    res.status(500).json({ error: 'Failed to compute shadow weighting' });
  }
});

// Phase D Item 4: Reasoning conclusions ownership
router.post('/reasoning-conclusions/replace', async (req, res) => {
  try {
    const { subjectType, subjectId, conclusions } = req.body;
    if (!subjectType || typeof subjectId !== 'number' || !Array.isArray(conclusions)) {
      return res.status(400).json({ error: 'subjectType, subjectId, and conclusions array are required' });
    }
    const inserted = await replaceReasoningConclusions(subjectType, subjectId, conclusions);
    res.json({ conclusions: inserted });
  } catch (error) {
    console.error('[internal] replace reasoning conclusions error:', error);
    res.status(500).json({ error: 'Failed to replace reasoning conclusions' });
  }
});

// Item 10: GET reasoning conclusions for explainability
router.get('/reasoning-conclusions', async (req, res) => {
  try {
    const { subjectType, subjectId } = req.query;
    if (!subjectType || !subjectId) {
      return res.status(400).json({ error: 'subjectType and subjectId are required' });
    }
    const { getReasoningConclusions } = await import('../db.js');
    const conclusions = await getReasoningConclusions(subjectType as string, parseInt(subjectId as string, 10));
    if (!conclusions || conclusions.length === 0) {
      return res.status(404).json({ error: 'Reasoning conclusions not found' });
    }
    // Return in the same format as the monolith endpoint
    res.json({
      subjectType,
      subjectId: parseInt(subjectId as string, 10),
      conclusions: conclusions.map(c => c.conclusions || []).flat(),
      reasoning: conclusions[0]?.reasoning || '',
      confidence: conclusions[0]?.confidence ?? 0.5
    });
  } catch (error) {
    console.error('[internal] get reasoning conclusions error:', error);
    res.status(500).json({ error: 'Failed to get reasoning conclusions' });
  }
});

export default router;
