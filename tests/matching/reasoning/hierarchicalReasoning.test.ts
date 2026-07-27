import { describe, it, expect } from 'vitest';
import { resolveSkillDomains, satisfactionToDraftConclusion, MAX_HOPS } from '../../../src/matching/reasoning/hierarchicalReasoning.js';

// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 3: Hierarchical
// Reasoning. Pure functions only - inferHierarchicalSatisfaction needs the DB (skill graph) and
// is covered by the integration test pass instead.

describe('resolveSkillDomains', () => {
  it('resolves a skill\'s direct PARENT_OF domain at 1 hop', () => {
    const results = resolveSkillDomains('AWS', [{ domainName: 'Cloud & Infrastructure', domainNodeId: 200 }], null);
    expect(results).toHaveLength(1);
    expect(results[0].hops).toBe(1);
    expect(results[0].domainName).toBe('Cloud & Infrastructure');
  });

  it('resolves a domain via a FRAMEWORK_OF parent at 2 hops when the skill has no direct domain', () => {
    const results = resolveSkillDomains('Django', [], { skillName: 'Python', directDomains: [{ domainName: 'Programming Languages', domainNodeId: 300 }] });
    expect(results).toHaveLength(1);
    expect(results[0].hops).toBe(2);
    expect(results[0].viaSkillName).toBe('Python');
  });

  it('never exceeds the documented max hop count', () => {
    expect(MAX_HOPS).toBe(2);
  });

  it('does not duplicate a domain already reached at hop 1 via the hop-2 path', () => {
    const results = resolveSkillDomains(
      'Django',
      [{ domainName: 'Web Development', domainNodeId: 400 }],
      { skillName: 'Python', directDomains: [{ domainName: 'Web Development', domainNodeId: 400 }] }
    );
    expect(results).toHaveLength(1);
    expect(results[0].hops).toBe(1);
  });

  it('returns nothing when the skill has neither a direct domain nor a framework parent with one', () => {
    expect(resolveSkillDomains('Mystery Skill', [], null)).toHaveLength(0);
  });
});

describe('satisfactionToDraftConclusion', () => {
  it('gives a 1-hop satisfaction higher confidence than a 2-hop one', () => {
    const hop1 = satisfactionToDraftConclusion({ domainName: 'Cloud & Infrastructure', domainNodeId: 200, satisfyingSkillName: 'AWS', satisfyingSkillNodeId: 1, hops: 1 });
    const hop2 = satisfactionToDraftConclusion({ domainName: 'Web Development', domainNodeId: 400, satisfyingSkillName: 'Django', satisfyingSkillNodeId: 2, hops: 2, viaSkillName: 'Python' });
    expect(hop1.conclusion_confidence).toBeGreaterThan(hop2.conclusion_confidence);
    expect(hop1.reasoning_type).toBe('hierarchical');
  });

  it('a 2-hop conclusion carries a 2-step evidence chain naming the intermediate skill', () => {
    const hop2 = satisfactionToDraftConclusion({ domainName: 'Web Development', domainNodeId: 400, satisfyingSkillName: 'Django', satisfyingSkillNodeId: 2, hops: 2, viaSkillName: 'Python' });
    expect(hop2.evidence_chain).toHaveLength(2);
    expect(hop2.evidence_chain[0].edge?.type).toBe('FRAMEWORK_OF');
    expect(hop2.evidence_chain[1].edge?.type).toBe('PARENT_OF');
  });
});
