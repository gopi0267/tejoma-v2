// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 2: Concept Reasoning.
//
// Aggregates multiple concrete skill instances under one shared PARENT_OF domain node
// (skillIntelligence.ts's domain hierarchy: e.g. "AI & Data Science" PARENT_OF TensorFlow,
// PyTorch, Keras, ...) into a broader, never-explicitly-stated competency claim: "candidate
// demonstrates {domain} competency". This is deliberately built on PARENT_OF (the real, seeded
// domain hierarchy) rather than the spec's original "instance_of MultiAgentFramework"-style
// example - no such fine-grained concept nodes (MultiAgentFramework, AgentOrchestration, ...)
// exist in this codebase's skill graph, and CrewAI/LangGraph/AutoGen aren't in the skill
// dictionary at all, so that worked example cannot be reproduced honestly against real data.
// The domain-aggregation version below is the closest real, defensible analog: a genuine,
// mechanically-derived hierarchy fact, not a fabricated concept taxonomy.

import { db } from '../../db.js';
import { canonicalizeSkills } from '../skillIntelligence.js';
import type { DraftConclusion, EvidenceStep } from '../../types.js';

// A claim about BREADTH ("candidate has broad {domain} competency") needs a higher evidentiary
// bar than a single hierarchical fact (see hierarchicalReasoning.ts, which allows a 1-instance
// match) - 3 distinct instances is the same minimum-corroboration bar skillDiscovery.ts already
// established for auto-promoting an unknown skill.
export const CONCEPT_INSTANCE_THRESHOLD = 3;

export interface SkillDomainPair {
  skillName: string;
  skillNodeId: number;
  domainName: string;
  domainNodeId: number;
}

export interface ConceptGroup {
  domainName: string;
  domainNodeId: number;
  instances: Array<{ skillName: string; skillNodeId: number }>;
}

// Pure - groups (skill, domain) pairs by domain, deduping repeated skills within a domain.
export function buildConceptGroups(pairs: SkillDomainPair[]): ConceptGroup[] {
  const byDomain = new Map<number, ConceptGroup>();
  for (const pair of pairs) {
    let group = byDomain.get(pair.domainNodeId);
    if (!group) {
      group = { domainName: pair.domainName, domainNodeId: pair.domainNodeId, instances: [] };
      byDomain.set(pair.domainNodeId, group);
    }
    if (!group.instances.some((i) => i.skillNodeId === pair.skillNodeId)) {
      group.instances.push({ skillName: pair.skillName, skillNodeId: pair.skillNodeId });
    }
  }
  return Array.from(byDomain.values());
}

// Pure - confidence rises with corroborating instance count past the threshold, capped at 1.0.
// 0.5 at exactly the threshold (3 instances), +0.15 per instance beyond it. subjectType makes the
// conclusion text correct for both subject types - a job's required_skills showing 3+ instances
// in one domain is a genuine, if differently-phrased, fact about the job, not a candidate.
export function conceptGroupsToDraftConclusions(groups: ConceptGroup[], subjectType: 'candidate' | 'job' = 'candidate'): DraftConclusion[] {
  const subjectPhrase = subjectType === 'candidate' ? 'Candidate demonstrates' : "This job's requirements demonstrate";
  return groups
    .filter((g) => g.instances.length >= CONCEPT_INSTANCE_THRESHOLD)
    .map((g) => {
      const confidence = Math.min(1, 0.5 + (g.instances.length - CONCEPT_INSTANCE_THRESHOLD) * 0.15);
      const evidenceChain: EvidenceStep[] = g.instances.map((inst, idx) => ({
        step: idx + 1,
        statement: `"${inst.skillName}" is under the "${g.domainName}" domain (PARENT_OF edge)`,
        source: 'skill_graph',
        edge: { from: g.domainName, to: inst.skillName, type: 'PARENT_OF' },
        verified: true,
      }));
      evidenceChain.push({
        step: evidenceChain.length + 1,
        statement: `${g.instances.length} distinct "${g.domainName}" skills detected (threshold: ${CONCEPT_INSTANCE_THRESHOLD})`,
        source: 'concept_aggregation',
        edge: null,
        verified: true,
      });
      return {
        conclusion_text: `${subjectPhrase} ${g.domainName} competency`,
        conclusion_type: 'domain_competency',
        reasoning_type: 'concept',
        evidence_chain: evidenceChain,
        conclusion_confidence: Number(confidence.toFixed(4)),
        confidence_derivation: `${g.instances.length} corroborating instances under one domain (threshold ${CONCEPT_INSTANCE_THRESHOLD}); 0.5 base + 0.15 per instance beyond threshold, capped at 1.0`,
        derived_from: 'skill_intelligence_graph',
      } satisfies DraftConclusion;
    });
}

// Orchestration: resolves raw skill text -> domain via canonicalizeSkill + the reverse PARENT_OF
// edge (getSkillEdgesTo, since domain --PARENT_OF--> skill), then delegates to the pure functions
// above.
export async function inferConceptsForSkills(rawSkillTexts: string[], subjectType: 'candidate' | 'job' = 'candidate'): Promise<DraftConclusion[]> {
  const resolved = await canonicalizeSkills(rawSkillTexts);
  const pairs: SkillDomainPair[] = [];

  for (const node of resolved) {
    if (!node) continue;
    const parentEdges = await db.getSkillEdgesTo(node.id, 'PARENT_OF');
    for (const edge of parentEdges) {
      const domainNode = await db.getSkillNodeById(edge.from_skill_id);
      if (domainNode) {
        pairs.push({ skillName: node.canonical_name, skillNodeId: node.id, domainName: domainNode.canonical_name, domainNodeId: domainNode.id });
      }
    }
  }

  return conceptGroupsToDraftConclusions(buildConceptGroups(pairs), subjectType);
}
