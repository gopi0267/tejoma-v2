// Enterprise AI Matching Architecture, Phase 10 - Explainability Layer, Module 3: Orchestrator.
//
// Wires §5.1 Reasoning Conclusions (Phase 9) + §2.4 Career Intelligence (Phase 8) + the existing
// live scoring engine's MatchBreakdown into one human-readable MatchNarrative. Deliberately
// computed live on every call, with NO new cache table:
//
//   - The original spec proposed a `match_explanations` table with a 24h TTL and invalidation
//     hooks on every candidate/job update path. This codebase already draws a clear line for when
//     that kind of caching is warranted: `detailed_scoring_reports` (src/rubric-scoring.service.ts)
//     caches because it wraps a real Gemini call. This explanation involves zero LLM calls - just
//     a handful of indexed DB reads (career_trajectories, reasoning_conclusions) plus pure
//     template functions - the same cost class as the Recruiter Review detail endpoint this phase
//     extends. Caching it would add a whole stale-data/invalidation-sync problem for no real
//     latency win.
//   - "Feature Store (§8)" (match_features table) is training data for the LTR model, a different
//     consumer - the real per-pair signal recruiters already see is MatchBreakdown, already
//     returned by calculateMatchScore and already persisted on each swipes row. This reuses that
//     directly instead of recomputing or coupling to the feature store.
//
// SCOPE BOUNDARY, SAME AS EVERY PRIOR PHASE: this generates an explanation ALONGSIDE the existing
// match score. It does not change how matches are scored, ranked, or filtered.

import { db } from '../../db.js';
import { computeCandidateSkillProficiency } from '../skillProficiency.js';
import { computeMatchFeatures } from '../services.js';
import { toSyntheticCandidateFromAccount } from '../matchingApi.js';
import {
  buildSkillsNarrative,
  buildSeniorityNarrative,
  buildCareerProgressionNarrative,
  buildTechnologyCoherenceNarrative,
  buildExecutiveSummary,
} from './narrativeGeneration.js';
import { detectConcerns } from './concernDetection.js';
import type {
  Candidate,
  Job,
  Swipe,
  CandidateAccount,
  MatchNarrative,
  CandidateMatchNarrative,
  InferredCompetencyNarrative,
  ReasoningType,
} from '../../types.js';

// Reasoning types surfaced as "inferred competencies" - semantic (name resolution) and
// technology_relationship (shown separately as its own breakdown section) are deliberately
// excluded here to avoid duplicating/cluttering the narrative.
const INFERRED_COMPETENCY_TYPES: ReasoningType[] = ['concept', 'causal', 'hierarchical'];
// Same floor Concept Reasoning itself uses as its own minimum defensible confidence (Phase 9) -
// this is a "show your reasoning" surface, not an auto-apply one, so conclusions at their own
// type's natural minimum are still worth showing with their real confidence number attached.
const INFERRED_COMPETENCY_MIN_CONFIDENCE = 0.5;

export async function computeMatchExplanation(candidate: Candidate, job: Job, history: Swipe[]): Promise<MatchNarrative> {
  const latestSwipe = history[0] ?? null;
  const breakdown = latestSwipe?.breakdown ?? null;

  const [proficiency, trajectory, candidateReasoning] = await Promise.all([
    computeCandidateSkillProficiency(candidate.skills, candidate.resume_summary, candidate.project_entries, candidate.certifications),
    db.getCareerTrajectory(candidate.id, candidate.company_id),
    db.getReasoningConclusions('candidate', candidate.id),
  ]);

  const currentRoleConfidence = trajectory?.job_sequence?.length ? trajectory.job_sequence[trajectory.job_sequence.length - 1].inferredSeniorityConfidence : null;

  const skillsNarrative = buildSkillsNarrative(breakdown, proficiency);
  const seniorityNarrative = buildSeniorityNarrative(trajectory?.seniority_level, currentRoleConfidence, job.title);
  const careerNarrative = buildCareerProgressionNarrative(trajectory);
  const technologyConclusion = candidateReasoning.find((c) => c.reasoning_type === 'technology_relationship') ?? null;
  const coherenceNarrative = buildTechnologyCoherenceNarrative(technologyConclusion);

  const inferredCompetencies: InferredCompetencyNarrative[] = candidateReasoning
    .filter((c) => INFERRED_COMPETENCY_TYPES.includes(c.reasoning_type) && c.conclusion_confidence >= INFERRED_COMPETENCY_MIN_CONFIDENCE)
    .map((c) => ({ conclusionText: c.conclusion_text, reasoningType: c.reasoning_type, confidence: c.conclusion_confidence, reasoningConclusionId: c.id }));

  const executiveSummary = buildExecutiveSummary(candidate.name, skillsNarrative, seniorityNarrative, careerNarrative);
  const concerns = detectConcerns(skillsNarrative.missing, trajectory?.gaps ?? null, seniorityNarrative);

  const reasoningConclusionsUsed = [...inferredCompetencies.map((c) => c.reasoningConclusionId), ...(technologyConclusion ? [technologyConclusion.id] : [])];

  return {
    candidateId: candidate.id,
    jobId: job.id,
    matchScore: latestSwipe?.match_score ?? null,
    matchScoreSource: latestSwipe ? 'latest_swipe' : 'unavailable',
    executiveSummary,
    detailedBreakdown: {
      skillsMatch: skillsNarrative,
      seniorityAlignment: seniorityNarrative,
      careerProgression: careerNarrative,
      technologyCoherence: coherenceNarrative,
      inferredCompetencies,
    },
    concerns,
    reasoningConclusionsUsed,
    generatedAt: new Date().toISOString(),
  };
}

// Candidate-facing surface - see this module's doc comment on why career/reasoning-layer data is
// deliberately omitted (no work_history/project_entries exist on the candidate_accounts-based
// scoring path candidate-jobs.routes.ts uses).
export async function computeCandidateMatchExplanation(account: CandidateAccount, job: Job): Promise<CandidateMatchNarrative> {
  const syntheticCandidate = toSyntheticCandidateFromAccount(account);
  const features = computeMatchFeatures(job, syntheticCandidate);
  const total = features.matchedSkills.length + features.missingSkills.length;

  const whyYouMatched =
    total > 0
      ? `You matched on ${features.matchedSkills.length} of ${total} required skill${total === 1 ? '' : 's'}${features.matchedSkills.length > 0 ? `: ${features.matchedSkills.join(', ')}` : '.'}`
      : 'This job has no specific required skills listed.';

  return {
    jobId: job.id,
    whyYouMatched,
    yourStrengths: features.matchedSkills,
    skillsToDevelop: features.missingSkills,
    generatedAt: new Date().toISOString(),
  };
}
