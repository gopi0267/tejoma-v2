import { describe, it, expect } from 'vitest';
import { buildMatchExplanation } from '../../src/matching/explainability.js';
import type { DynamicSkillScoreResult, DynamicWeights } from '../../src/matching/dynamicWeighting.js';
import type { ConfidenceProfile } from '../../src/matching/confidenceService.js';

// Enterprise AI Matching Architecture, Phase 2 - Explainability. Pure function, no DB dependency -
// buildMatchExplanation only consumes already-computed results.

const baseWeights: DynamicWeights = { skillWeight: 0.40, experienceWeight: 0.35, locationWeight: 0.15, salaryWeight: 0.10, seniorityNote: null };

function makeSkillResult(overrides: Partial<DynamicSkillScoreResult> = {}): DynamicSkillScoreResult {
  return { score: 80, matched: [], missingMandatory: [], missingOther: [], ...overrides };
}

describe('buildMatchExplanation - required fields (matched skills, graph-derived matches, missing mandatory)', () => {
  it('includes every matched skill in matchedSkills', () => {
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({ matched: [{ requiredSkill: 'Python', tier: 'mandatory', matchType: 'exact', matchedCandidateSkill: 'Python' }] }),
      weights: baseWeights,
    });
    expect(result.matchedSkills).toHaveLength(1);
    expect(result.matchedSkills[0].requiredSkill).toBe('Python');
  });

  it('separates graph-derived matches from exact matches', () => {
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({
        matched: [
          { requiredSkill: 'Python', tier: 'mandatory', matchType: 'exact', matchedCandidateSkill: 'Python' },
          { requiredSkill: 'React', tier: 'preferred', matchType: 'graph_related', matchedCandidateSkill: 'Vue.js', relationshipType: 'RELATED_TO' },
        ],
      }),
      weights: baseWeights,
    });
    expect(result.matchedSkills).toHaveLength(2);
    expect(result.graphDerivedMatches).toHaveLength(1);
    expect(result.graphDerivedMatches[0].matchedCandidateSkill).toBe('Vue.js');
  });

  it('surfaces missing mandatory skills as a first-class, separate field from other missing skills', () => {
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({ missingMandatory: ['Kubernetes'], missingOther: ['Grafana'] }),
      weights: baseWeights,
    });
    expect(result.missingMandatorySkills).toEqual(['Kubernetes']);
    expect(result.missingOtherSkills).toEqual(['Grafana']);
  });
});

describe('buildMatchExplanation - confidence values', () => {
  const confidenceProfile: ConfidenceProfile = {
    schema_version: 1,
    computed_at: new Date().toISOString(),
    overall: { level: 'high', score: 0.9, basis: 'test' },
    skills: { Kubernetes: { level: 'medium', score: 0.5, basis: 'Not found verbatim in resume' } },
    experience: { level: 'high', score: 0.9, basis: 'test' },
    education: { level: 'high', score: 0.9, basis: 'test' },
    projects: { level: 'high', score: 0.9, basis: 'test' },
  };

  it('adds a confidence note for a matched skill with less-than-high confidence', () => {
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({ matched: [{ requiredSkill: 'Kubernetes', tier: 'preferred', matchType: 'exact', matchedCandidateSkill: 'Kubernetes' }] }),
      weights: baseWeights,
      confidenceProfile,
    });
    expect(result.confidenceNotes.length).toBeGreaterThan(0);
    expect(result.confidenceNotes[0]).toContain('Kubernetes');
  });

  it('produces no confidence notes when no confidence profile is supplied', () => {
    const result = buildMatchExplanation({ skillResult: makeSkillResult(), weights: baseWeights });
    expect(result.confidenceNotes).toEqual([]);
  });

  it('produces no confidence notes when every relevant confidence is already high', () => {
    const highConfidence: ConfidenceProfile = { ...confidenceProfile, skills: { Python: { level: 'high', score: 0.95, basis: 'test' } } };
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({ matched: [{ requiredSkill: 'Python', tier: 'mandatory', matchType: 'exact', matchedCandidateSkill: 'Python' }] }),
      weights: baseWeights,
      confidenceProfile: highConfidence,
    });
    expect(result.confidenceNotes).toEqual([]);
  });
});

describe('buildMatchExplanation - dynamic weight contribution', () => {
  it('reports the exact weights passed in, including a seniority note when present', () => {
    const weights: DynamicWeights = { skillWeight: 0.37, experienceWeight: 0.38, locationWeight: 0.15, salaryWeight: 0.10, seniorityNote: 'Required experience shifted weight' };
    const result = buildMatchExplanation({ skillResult: makeSkillResult(), weights });
    expect(result.dynamicWeightContribution.skillWeight).toBe(0.37);
    expect(result.dynamicWeightContribution.experienceWeight).toBe(0.38);
    expect(result.dynamicWeightContribution.seniorityNote).toBe('Required experience shifted weight');
  });

  it('includes the tier weights used for the skill score', () => {
    const result = buildMatchExplanation({ skillResult: makeSkillResult(), weights: baseWeights });
    expect(result.dynamicWeightContribution.skillTierWeights.mandatory).toBeGreaterThan(result.dynamicWeightContribution.skillTierWeights.bonus);
  });
});

describe('buildMatchExplanation - human-readable reasoning', () => {
  it('states that every mandatory requirement was matched when none are missing', () => {
    const result = buildMatchExplanation({
      skillResult: makeSkillResult({ matched: [{ requiredSkill: 'Python', tier: 'mandatory', matchType: 'exact', matchedCandidateSkill: 'Python' }] }),
      weights: baseWeights,
    });
    expect(result.reasoning).toContain('mandatory');
  });

  it('explicitly names missing mandatory skills in the reasoning text', () => {
    const result = buildMatchExplanation({ skillResult: makeSkillResult({ missingMandatory: ['Kubernetes', 'Docker'] }), weights: baseWeights });
    expect(result.reasoning).toContain('Kubernetes');
    expect(result.reasoning).toContain('Docker');
  });

  it('mentions the seniority adjustment in reasoning when one occurred', () => {
    const weights: DynamicWeights = { ...baseWeights, seniorityNote: 'Required experience (8+ yrs) shifted weight' };
    const result = buildMatchExplanation({ skillResult: makeSkillResult(), weights });
    expect(result.reasoning).toContain('8+ yrs');
  });

  it('never crashes and always produces a non-empty string even with no signals at all', () => {
    const result = buildMatchExplanation({ skillResult: makeSkillResult({ score: 100 }), weights: baseWeights });
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(0);
  });
});

describe('buildMatchExplanation - schema', () => {
  it('always includes schema_version', () => {
    const result = buildMatchExplanation({ skillResult: makeSkillResult(), weights: baseWeights });
    expect(result.schema_version).toBe(1);
  });
});
