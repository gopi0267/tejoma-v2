import { describe, it, expect } from 'vitest';
import { aggregateImplications, implicationsToDraftConclusions } from '../../../src/matching/reasoning/causalReasoning.js';

// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 4: Causal Reasoning.
// Pure functions only - inferCausalImplications needs the DB (via projectIntelligence.ts's
// analyzeProjectEntries) and is covered by the integration test pass instead.

describe('aggregateImplications', () => {
  it('groups implication tuples by implied skill name', () => {
    const tuples = [
      { impliedSkillName: 'Docker', viaSkill: 'Kubernetes', relationshipType: 'USES' as const, projectName: 'Infra Project' },
      { impliedSkillName: 'Docker', viaSkill: 'Docker Compose', relationshipType: 'USES' as const, projectName: 'Local Dev Setup' },
    ];
    const result = aggregateImplications(tuples, []);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(2);
  });

  it('drops an implied skill the candidate already explicitly listed - not a real inference otherwise', () => {
    const tuples = [{ impliedSkillName: 'Docker', viaSkill: 'Kubernetes', relationshipType: 'USES' as const, projectName: null }];
    expect(aggregateImplications(tuples, ['Docker', 'Python'])).toHaveLength(0);
  });

  it('is case-insensitive when checking against explicit skills', () => {
    const tuples = [{ impliedSkillName: 'Docker', viaSkill: 'Kubernetes', relationshipType: 'USES' as const, projectName: null }];
    expect(aggregateImplications(tuples, ['docker'])).toHaveLength(0);
  });

  it('never duplicates the exact same corroborating source twice', () => {
    const tuples = [
      { impliedSkillName: 'Docker', viaSkill: 'Kubernetes', relationshipType: 'USES' as const, projectName: 'Infra Project' },
      { impliedSkillName: 'Docker', viaSkill: 'Kubernetes', relationshipType: 'USES' as const, projectName: 'Infra Project' },
    ];
    expect(aggregateImplications(tuples, [])[0].sources).toHaveLength(1);
  });
});

describe('implicationsToDraftConclusions', () => {
  it('produces one auditable conclusion per implied skill with a real edge in its evidence', () => {
    const conclusions = implicationsToDraftConclusions([
      { impliedSkillName: 'Docker', sources: [{ viaSkill: 'Kubernetes', relationshipType: 'USES', projectName: 'Infra Project' }] },
    ]);
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0].reasoning_type).toBe('causal');
    expect(conclusions[0].evidence_chain[0].edge).toEqual({ from: 'Kubernetes', to: 'Docker', type: 'USES' });
  });

  it('confidence rises with more independent corroborating sources, capped at 1.0', () => {
    const oneSource = implicationsToDraftConclusions([{ impliedSkillName: 'Docker', sources: [{ viaSkill: 'Kubernetes', relationshipType: 'USES', projectName: null }] }])[0];
    const twoSources = implicationsToDraftConclusions([
      { impliedSkillName: 'Docker', sources: [{ viaSkill: 'Kubernetes', relationshipType: 'USES', projectName: null }, { viaSkill: 'Docker Compose', relationshipType: 'USES', projectName: null }] },
    ])[0];
    expect(twoSources.conclusion_confidence).toBeGreaterThan(oneSource.conclusion_confidence);
    expect(oneSource.conclusion_confidence).toBeLessThanOrEqual(1);
  });
});
