import { describe, it, expect } from 'vitest';
import { computeStackCoherence, coherenceResultToDraftConclusion, MIN_SKILLS_FOR_COHERENCE } from '../../../src/matching/reasoning/technologyRelationship.js';
import type { SkillRelationshipType } from '../../../src/types.js';

// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 5: Technology
// Relationship Reasoning. Pure functions only - inferStackCoherence needs the DB (skill graph)
// and is covered by the integration test pass instead.

function adjacency(pairs: Array<[string, string, SkillRelationshipType]>): Map<string, Map<string, SkillRelationshipType>> {
  const map = new Map<string, Map<string, SkillRelationshipType>>();
  for (const [a, b, type] of pairs) {
    if (!map.has(a)) map.set(a, new Map());
    map.get(a)!.set(b, type);
  }
  return map;
}

describe('computeStackCoherence', () => {
  it('returns null below the minimum skill count - not a meaningful measurement with too few skills', () => {
    expect(MIN_SKILLS_FOR_COHERENCE).toBe(3);
    expect(computeStackCoherence(['React', 'Redux'], adjacency([]))).toBeNull();
  });

  it('scores 1.0 when every possible pair is connected', () => {
    const result = computeStackCoherence(
      ['React', 'Redux', 'Jest'],
      adjacency([
        ['React', 'Redux', 'COMMONLY_WITH'],
        ['React', 'Jest', 'COMMONLY_WITH'],
        ['Redux', 'Jest', 'COMMONLY_WITH'],
      ])
    );
    expect(result!.coherenceScore).toBe(1);
  });

  it('scores 0 when no pairs are connected', () => {
    const result = computeStackCoherence(['React', 'COBOL', 'Fortran'], adjacency([]));
    expect(result!.coherenceScore).toBe(0);
  });

  it('checks both edge directions for a pair (edges are not always stored symmetrically, e.g. FRAMEWORK_OF)', () => {
    const result = computeStackCoherence(['Django', 'Python', 'Flask'], adjacency([['Django', 'Python', 'FRAMEWORK_OF']]));
    expect(result!.supportedPairs).toHaveLength(1);
  });

  it('dedupes repeated skill names before pairing', () => {
    const result = computeStackCoherence(['React', 'React', 'Redux', 'Jest'], adjacency([]));
    expect(result!.skillNames).toHaveLength(3);
  });
});

describe('coherenceResultToDraftConclusion', () => {
  it('produces a neutral, non-judgmental conclusion with an evidence chain per supported pair', () => {
    const result = computeStackCoherence(
      ['React', 'Redux', 'Jest'],
      adjacency([['React', 'Redux', 'COMMONLY_WITH']])
    )!;
    const draft = coherenceResultToDraftConclusion(result);
    expect(draft.reasoning_type).toBe('technology_relationship');
    expect(draft.conclusion_text).not.toMatch(/red flag|incoherent|conflict/i);
    expect(draft.evidence_chain.length).toBe(result.supportedPairs.length + 1); // + aggregate step
  });

  it('measurement confidence rises with more pairs evaluated, capped below 1.0', () => {
    const small = coherenceResultToDraftConclusion(computeStackCoherence(['A', 'B', 'C'], adjacency([]))!);
    const large = coherenceResultToDraftConclusion(
      computeStackCoherence(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], adjacency([]))!
    );
    expect(large.conclusion_confidence).toBeGreaterThan(small.conclusion_confidence);
    expect(large.conclusion_confidence).toBeLessThan(1);
  });
});
