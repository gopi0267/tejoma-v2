// Enterprise AI Matching Architecture, Phase 2 - Explainability, extended into its own component.
//
// Consumes the SAME data the scoring functions already computed (dynamicWeighting.ts's skill
// match result, the candidate's Phase 1 confidence_profile) and turns it into a structured object
// plus a deterministic, template-built human-readable summary - never an LLM call. This matches
// the anti-hallucination discipline already established elsewhere in this codebase (the resume
// parser's own post-extraction sanity checks): the reasoning text can never state something the
// structured data doesn't support, and never depends on an external API being available.
//
// Backward compatibility: this is attached to MatchBreakdown as a new, optional `explanation`
// field (see types.ts) - every existing reader of `breakdown.skills`/`breakdown.experience`/etc.
// is completely unaffected. Only present when a caller explicitly requests dynamic weighting via
// matchingApi.ts's `weighting: 'dynamic'` option.

import type { ConfidenceProfile } from './confidenceService.js';
import { TIER_WEIGHTS } from './dynamicWeighting.js';
import type { DynamicSkillScoreResult, DynamicWeights, SkillMatchOutcome, SkillTier } from './dynamicWeighting.js';

export interface MatchExplanation {
  schema_version: 1;
  matchedSkills: SkillMatchOutcome[];
  graphDerivedMatches: SkillMatchOutcome[]; // subset of matchedSkills where matchType === 'graph_related'
  missingMandatorySkills: string[];
  missingOtherSkills: string[];
  confidenceNotes: string[];
  dynamicWeightContribution: {
    skillWeight: number;
    experienceWeight: number;
    locationWeight: number;
    salaryWeight: number;
    seniorityNote: string | null;
    skillTierWeights: { mandatory: number; preferred: number; optional: number; bonus: number };
  };
  reasoning: string;
}

const TIER_LABEL: Record<SkillTier, string> = { mandatory: 'mandatory', preferred: 'preferred', optional: 'optional', bonus: 'bonus' };

function buildConfidenceNotes(matchedSkills: SkillMatchOutcome[], confidenceProfile?: ConfidenceProfile | null): string[] {
  if (!confidenceProfile) return [];
  const notes: string[] = [];
  for (const outcome of matchedSkills) {
    const basis = confidenceProfile.skills[outcome.matchedCandidateSkill] ?? confidenceProfile.skills[outcome.requiredSkill];
    if (basis && basis.level !== 'high') {
      notes.push(`"${outcome.matchedCandidateSkill}" matched at ${basis.level} confidence - ${basis.basis.toLowerCase()}`);
    }
  }
  if (confidenceProfile.overall.level !== 'high') {
    notes.push(`Overall resume-extraction confidence is ${confidenceProfile.overall.level} - ${confidenceProfile.overall.basis.toLowerCase()}`);
  }
  return notes;
}

function buildReasoning(params: {
  skillResult: DynamicSkillScoreResult;
  weights: DynamicWeights;
  graphDerivedCount: number;
  confidenceNoteCount: number;
}): string {
  const { skillResult, weights, graphDerivedCount, confidenceNoteCount } = params;
  const sentences: string[] = [];

  const totalRequired = skillResult.matched.length + skillResult.missingMandatory.length + skillResult.missingOther.length;
  if (totalRequired === 0) {
    sentences.push('No specific skills were required for this role, so the skill component of the score is neutral.');
  } else if (skillResult.missingMandatory.length === 0) {
    sentences.push(`Matched ${skillResult.matched.length} of ${totalRequired} relevant skills, including every mandatory requirement.`);
  } else {
    sentences.push(`Missing ${skillResult.missingMandatory.length} mandatory skill${skillResult.missingMandatory.length > 1 ? 's' : ''}: ${skillResult.missingMandatory.join(', ')}.`);
  }

  if (graphDerivedCount > 0) {
    sentences.push(`${graphDerivedCount} match${graphDerivedCount > 1 ? 'es were' : ' was'} found through related or adjacent skills rather than an exact name match.`);
  }

  if (weights.seniorityNote) {
    sentences.push(weights.seniorityNote + '.');
  }

  if (confidenceNoteCount > 0) {
    sentences.push(`${confidenceNoteCount} matched skill${confidenceNoteCount > 1 ? 's carry' : ' carries'} lower extraction confidence and may be worth a closer look.`);
  }

  return sentences.join(' ');
}

export function buildMatchExplanation(params: {
  skillResult: DynamicSkillScoreResult;
  weights: DynamicWeights;
  confidenceProfile?: ConfidenceProfile | null;
}): MatchExplanation {
  const { skillResult, weights, confidenceProfile } = params;
  const graphDerivedMatches = skillResult.matched.filter((m) => m.matchType === 'graph_related');
  const confidenceNotes = buildConfidenceNotes(skillResult.matched, confidenceProfile);

  return {
    schema_version: 1,
    matchedSkills: skillResult.matched,
    graphDerivedMatches,
    missingMandatorySkills: skillResult.missingMandatory,
    missingOtherSkills: skillResult.missingOther,
    confidenceNotes,
    dynamicWeightContribution: {
      skillWeight: weights.skillWeight,
      experienceWeight: weights.experienceWeight,
      locationWeight: weights.locationWeight,
      salaryWeight: weights.salaryWeight,
      seniorityNote: weights.seniorityNote,
      skillTierWeights: TIER_WEIGHTS,
    },
    reasoning: buildReasoning({ skillResult, weights, graphDerivedCount: graphDerivedMatches.length, confidenceNoteCount: confidenceNotes.length }),
  };
}
