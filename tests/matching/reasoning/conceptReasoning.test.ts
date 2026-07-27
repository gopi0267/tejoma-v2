import { describe, it, expect } from 'vitest';
import { buildConceptGroups, conceptGroupsToDraftConclusions, CONCEPT_INSTANCE_THRESHOLD } from '../../../src/matching/reasoning/conceptReasoning.js';

// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 2: Concept Reasoning.
// Pure functions only - inferConceptsForSkills needs the DB (skill graph) and is covered by the
// integration test pass instead.

describe('buildConceptGroups', () => {
  it('groups skills under their shared domain', () => {
    const pairs = [
      { skillName: 'TensorFlow', skillNodeId: 1, domainName: 'AI & Data Science', domainNodeId: 100 },
      { skillName: 'PyTorch', skillNodeId: 2, domainName: 'AI & Data Science', domainNodeId: 100 },
      { skillName: 'AWS', skillNodeId: 3, domainName: 'Cloud & Infrastructure', domainNodeId: 200 },
    ];
    const groups = buildConceptGroups(pairs);
    expect(groups).toHaveLength(2);
    const aiGroup = groups.find((g) => g.domainNodeId === 100)!;
    expect(aiGroup.instances).toHaveLength(2);
  });

  it('dedupes the same skill appearing twice under one domain', () => {
    const pairs = [
      { skillName: 'TensorFlow', skillNodeId: 1, domainName: 'AI & Data Science', domainNodeId: 100 },
      { skillName: 'TensorFlow', skillNodeId: 1, domainName: 'AI & Data Science', domainNodeId: 100 },
    ];
    expect(buildConceptGroups(pairs)[0].instances).toHaveLength(1);
  });
});

describe('conceptGroupsToDraftConclusions', () => {
  it('requires at least the threshold number of instances before concluding anything', () => {
    const group = {
      domainName: 'AI & Data Science',
      domainNodeId: 100,
      instances: [
        { skillName: 'TensorFlow', skillNodeId: 1 },
        { skillName: 'PyTorch', skillNodeId: 2 },
      ],
    };
    expect(CONCEPT_INSTANCE_THRESHOLD).toBe(3);
    expect(conceptGroupsToDraftConclusions([group])).toHaveLength(0);
  });

  it('emits one conclusion per domain meeting the threshold, naming the domain never explicitly stated', () => {
    const group = {
      domainName: 'AI & Data Science',
      domainNodeId: 100,
      instances: [
        { skillName: 'TensorFlow', skillNodeId: 1 },
        { skillName: 'PyTorch', skillNodeId: 2 },
        { skillName: 'Keras', skillNodeId: 3 },
      ],
    };
    const conclusions = conceptGroupsToDraftConclusions([group]);
    expect(conclusions).toHaveLength(1);
    expect(conclusions[0].conclusion_text).toContain('AI & Data Science');
    expect(conclusions[0].reasoning_type).toBe('concept');
    expect(conclusions[0].conclusion_confidence).toBeCloseTo(0.5, 4);
  });

  it('confidence rises with more corroborating instances, capped at 1.0', () => {
    const makeGroup = (n: number) => ({
      domainName: 'AI & Data Science',
      domainNodeId: 100,
      instances: Array.from({ length: n }, (_, i) => ({ skillName: `Skill${i}`, skillNodeId: i })),
    });
    const at3 = conceptGroupsToDraftConclusions([makeGroup(3)])[0].conclusion_confidence;
    const at6 = conceptGroupsToDraftConclusions([makeGroup(6)])[0].conclusion_confidence;
    const at10 = conceptGroupsToDraftConclusions([makeGroup(10)])[0].conclusion_confidence;
    expect(at6).toBeGreaterThan(at3);
    expect(at10).toBe(1);
  });

  it('every evidence step is a real PARENT_OF edge, plus one aggregate step', () => {
    const group = {
      domainName: 'AI & Data Science',
      domainNodeId: 100,
      instances: [
        { skillName: 'TensorFlow', skillNodeId: 1 },
        { skillName: 'PyTorch', skillNodeId: 2 },
        { skillName: 'Keras', skillNodeId: 3 },
      ],
    };
    const chain = conceptGroupsToDraftConclusions([group])[0].evidence_chain;
    expect(chain).toHaveLength(4); // 3 instances + 1 aggregate
    expect(chain.slice(0, 3).every((s) => s.edge?.type === 'PARENT_OF')).toBe(true);
    expect(chain.every((s) => s.verified)).toBe(true);
  });
});
