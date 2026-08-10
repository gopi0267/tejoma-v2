import { describe, it, expect } from 'vitest';
import {
  extractDomainsFromHierarchicalConclusions,
  computeDensitySignal,
  computeCoverageResult,
  computeQualitySignal,
  combineReasoningSignals,
} from '../../src/matching/reasoningWeighting.js';
import type { ReasoningConclusion } from '../../src/types.js';

// Enterprise AI Matching Architecture, Phase 15 - Reasoning Conclusions Weighting, SHADOW MODE
// ONLY. Pure functions only - computeReasoningShadowResult needs the DB and is covered by the
// integration test pass instead. None of this ever affects a live match score, and none of it
// re-traverses the skill graph - it only reads Phase 9's already-computed conclusions (see the
// module's own doc comment).

function makeConclusion(overrides: Partial<ReasoningConclusion> = {}): ReasoningConclusion {
  return {
    id: 1, subject_type: 'candidate', subject_id: 1, conclusion_text: 'test', conclusion_type: 'domain_satisfiability',
    reasoning_type: 'hierarchical', evidence_chain: [], conclusion_confidence: 0.9, confidence_derivation: '',
    derived_from: 'skill_intelligence_graph', created_at: '',
    ...overrides,
  };
}

describe('extractDomainsFromHierarchicalConclusions', () => {
  it('extracts the domain from a 1-hop PARENT_OF evidence step', () => {
    const c = makeConclusion({
      evidence_chain: [{ step: 1, statement: '', source: '', edge: { from: 'Cloud & Infrastructure', to: 'AWS', type: 'PARENT_OF' }, verified: true }],
    });
    expect(extractDomainsFromHierarchicalConclusions([c])).toEqual(['Cloud & Infrastructure']);
  });

  it('extracts the domain from a 2-hop chain (FRAMEWORK_OF then PARENT_OF)', () => {
    const c = makeConclusion({
      evidence_chain: [
        { step: 1, statement: '', source: '', edge: { from: 'Django', to: 'Python', type: 'FRAMEWORK_OF' }, verified: true },
        { step: 2, statement: '', source: '', edge: { from: 'Programming Languages', to: 'Python', type: 'PARENT_OF' }, verified: true },
      ],
    });
    expect(extractDomainsFromHierarchicalConclusions([c])).toEqual(['Programming Languages']);
  });

  it('ignores non-hierarchical conclusions', () => {
    const c = makeConclusion({ reasoning_type: 'concept', evidence_chain: [{ step: 1, statement: '', source: '', edge: { from: 'X', to: 'Y', type: 'PARENT_OF' }, verified: true }] });
    expect(extractDomainsFromHierarchicalConclusions([c])).toHaveLength(0);
  });

  it('dedupes repeated domains across multiple conclusions', () => {
    const mk = () => makeConclusion({ evidence_chain: [{ step: 1, statement: '', source: '', edge: { from: 'AI & Data Science', to: 'X', type: 'PARENT_OF' }, verified: true }] });
    expect(extractDomainsFromHierarchicalConclusions([mk(), mk()])).toEqual(['AI & Data Science']);
  });
});

describe('computeDensitySignal', () => {
  it('is 0 with no concept conclusions - never fabricates density from nothing', () => {
    expect(computeDensitySignal([])).toBe(0);
  });

  it('rises with more concept conclusions, capped at the count/3 normalization', () => {
    const one = computeDensitySignal([makeConclusion({ reasoning_type: 'concept', conclusion_confidence: 1 })]);
    const three = computeDensitySignal([
      makeConclusion({ reasoning_type: 'concept', conclusion_confidence: 1 }),
      makeConclusion({ reasoning_type: 'concept', conclusion_confidence: 1 }),
      makeConclusion({ reasoning_type: 'concept', conclusion_confidence: 1 }),
    ]);
    expect(three).toBeGreaterThan(one);
    expect(three).toBeCloseTo(1, 4); // 3/3 count signal * 1.0 confidence
  });

  it('is weighted down by low confidence', () => {
    const highConf = computeDensitySignal([makeConclusion({ conclusion_confidence: 1 })]);
    const lowConf = computeDensitySignal([makeConclusion({ conclusion_confidence: 0.5 })]);
    expect(lowConf).toBeLessThan(highConf);
  });
});

describe('computeCoverageResult', () => {
  it('is 0 with no coverage/uncovered when the job has no domain requirements yet - not a penalty', () => {
    const result = computeCoverageResult(['Cloud & Infrastructure'], []);
    expect(result.coverageSignal).toBe(0);
    expect(result.covered).toHaveLength(0);
    expect(result.uncovered).toHaveLength(0);
  });

  it('computes real overlap, case-insensitively', () => {
    const result = computeCoverageResult(['cloud & infrastructure', 'AI & Data Science'], ['Cloud & Infrastructure', 'Programming Languages']);
    expect(result.coverageSignal).toBeCloseTo(0.5, 4);
    expect(result.covered).toEqual(['Cloud & Infrastructure']);
    expect(result.uncovered).toEqual(['Programming Languages']);
  });

  it('is 1.0 when every job domain is covered', () => {
    const result = computeCoverageResult(['Cloud & Infrastructure'], ['Cloud & Infrastructure']);
    expect(result.coverageSignal).toBe(1);
  });
});

describe('computeQualitySignal', () => {
  it('is the neutral floor (0.5) with no corroborating conclusions', () => {
    expect(computeQualitySignal([])).toBe(0.5);
  });

  it('is the real average confidence of the conclusions used', () => {
    const signal = computeQualitySignal([makeConclusion({ conclusion_confidence: 0.8 }), makeConclusion({ conclusion_confidence: 1.0 })]);
    expect(signal).toBeCloseTo(0.9, 4);
  });
});

describe('combineReasoningSignals', () => {
  it('is exactly neutral (1.0) at zero confidence, regardless of the raw signals', () => {
    expect(combineReasoningSignals(1, 1, 1, 0)).toBe(1);
  });

  it('boosts with real density, coverage, and quality signals at full confidence', () => {
    const multiplier = combineReasoningSignals(1, 1, 1, 1);
    // density: 1+1*0.25=1.25; coverage: 1+1*0.20=1.20; quality: 1+0.5*0.20=1.10
    // combined: 1.25*1.20*1.10=1.65, capped at 1.30
    expect(multiplier).toBe(1.3);
  });

  it('never penalizes below the min cap even with zero signals', () => {
    const multiplier = combineReasoningSignals(0, 0, 0, 1);
    expect(multiplier).toBeGreaterThanOrEqual(0.7);
    expect(multiplier).toBe(1); // 0 density/coverage/quality-above-0.5 all compose to exactly 1.0
  });

  it('respects the global multiplier cap [0.70, 1.30]', () => {
    expect(combineReasoningSignals(1, 1, 1, 1)).toBeLessThanOrEqual(1.3);
    expect(combineReasoningSignals(0, 0, 0, 1)).toBeGreaterThanOrEqual(0.7);
  });
});
