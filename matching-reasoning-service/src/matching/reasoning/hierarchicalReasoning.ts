// Ported byte-identical from the monolith's src/matching/reasoning/hierarchicalReasoning.ts
// (Batch 26). Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 3:
// Hierarchical Reasoning.
//
// Answers a different question than Concept Reasoning: not "does this subject show BROAD
// competency in a domain" (which needs 3+ corroborating instances), but "does this subject's
// skill list satisfy this broad domain AT ALL, and via which specific skill" (a single match is
// enough - e.g. one cloud platform genuinely does satisfy "needs cloud experience"). Precomputed
// per subject (candidate or job), not per candidate x job pair: per §5.1 Decision 3
// (precomputation, not per-request), multi-hop traversal for every possible pair would be the
// exact unconstrained hot path this architecture is built to avoid. What's cached here is the
// cheap, reusable fact - "this subject's skills reach these domains" - so a future phase that
// resolves a job requirement like "cloud experience" to the "Cloud & Infrastructure" domain node
// can satisfy it with an O(1) lookup against a candidate's precomputed set instead of a fresh
// graph traversal per match.
//
// Two hops, same as the spec's own max_hops=2:
//   hop 1: skill --PARENT_OF(reverse)--> its own domain (direct category mapping, seeded for
//          every dictionary entry - see skillIntelligence.ts's seedSkillIntelligence step 2)
//   hop 2: skill --FRAMEWORK_OF--> parent skill --PARENT_OF(reverse)--> a domain not already
//          reached at hop 1 (covers the rare case where a skill's own domain mapping doesn't
//          exist but its framework parent's does)

import { db } from '../../db.js';
import { canonicalizeSkills } from '../skillLookup.js';
import type { DraftConclusion, EvidenceStep } from '../../types.js';

export const MAX_HOPS = 2;
const HOP_CONFIDENCE: Record<number, number> = { 1: 0.95, 2: 0.65 };

export interface HierarchicalSatisfaction {
  domainName: string;
  domainNodeId: number;
  satisfyingSkillName: string;
  satisfyingSkillNodeId: number;
  hops: number;
  viaSkillName?: string; // present only for hop-2 (the FRAMEWORK_OF intermediate)
}

// Pure - given one skill's direct-domain edges and (optionally) its FRAMEWORK_OF parent's
// direct-domain edges, returns every domain this skill reaches, closest hop first, deduped by
// domain.
export function resolveSkillDomains(
  skillName: string,
  directDomains: Array<{ domainName: string; domainNodeId: number }>,
  frameworkParent: { skillName: string; directDomains: Array<{ domainName: string; domainNodeId: number }> } | null
): HierarchicalSatisfaction[] {
  const seen = new Set<number>();
  const results: HierarchicalSatisfaction[] = [];

  for (const d of directDomains) {
    if (seen.has(d.domainNodeId)) continue;
    seen.add(d.domainNodeId);
    results.push({ domainName: d.domainName, domainNodeId: d.domainNodeId, satisfyingSkillName: skillName, satisfyingSkillNodeId: -1, hops: 1 });
  }

  if (frameworkParent) {
    for (const d of frameworkParent.directDomains) {
      if (seen.has(d.domainNodeId)) continue;
      seen.add(d.domainNodeId);
      results.push({
        domainName: d.domainName,
        domainNodeId: d.domainNodeId,
        satisfyingSkillName: skillName,
        satisfyingSkillNodeId: -1,
        hops: 2,
        viaSkillName: frameworkParent.skillName,
      });
    }
  }

  return results;
}

export function satisfactionToDraftConclusion(s: HierarchicalSatisfaction, subjectType: 'candidate' | 'job' = 'candidate'): DraftConclusion {
  const subjectPhrase = subjectType === 'candidate' ? 'Candidate satisfies' : "This job's requirements fall under";
  const confidence = HOP_CONFIDENCE[s.hops] ?? 0.5;
  const evidenceChain: EvidenceStep[] =
    s.hops === 1
      ? [
          {
            step: 1,
            statement: `"${s.satisfyingSkillName}" is under the "${s.domainName}" domain (PARENT_OF edge)`,
            source: 'skill_graph',
            edge: { from: s.domainName, to: s.satisfyingSkillName, type: 'PARENT_OF' },
            verified: true,
          },
        ]
      : [
          {
            step: 1,
            statement: `"${s.satisfyingSkillName}" is FRAMEWORK_OF "${s.viaSkillName}"`,
            source: 'skill_graph',
            edge: { from: s.satisfyingSkillName, to: s.viaSkillName!, type: 'FRAMEWORK_OF' },
            verified: true,
          },
          {
            step: 2,
            statement: `"${s.viaSkillName}" is under the "${s.domainName}" domain (PARENT_OF edge)`,
            source: 'skill_graph',
            edge: { from: s.domainName, to: s.viaSkillName!, type: 'PARENT_OF' },
            verified: true,
          },
        ];

  return {
    conclusion_text: `${subjectPhrase} the "${s.domainName}" domain via "${s.satisfyingSkillName}"`,
    conclusion_type: 'domain_satisfiability',
    reasoning_type: 'hierarchical',
    evidence_chain: evidenceChain,
    conclusion_confidence: confidence,
    confidence_derivation: `${s.hops}-hop graph traversal (1 hop = direct category mapping, 2 hops = via a FRAMEWORK_OF parent)`,
    derived_from: 'skill_intelligence_graph',
  };
}

// Orchestration - resolves each raw skill, walks its direct PARENT_OF domain(s) and (if it has
// one) its FRAMEWORK_OF parent's direct domain(s), and emits one conclusion per (skill, domain)
// satisfiability fact found.
export async function inferHierarchicalSatisfaction(rawSkillTexts: string[], subjectType: 'candidate' | 'job' = 'candidate'): Promise<DraftConclusion[]> {
  const resolved = await canonicalizeSkills(rawSkillTexts);
  const conclusions: DraftConclusion[] = [];

  for (const node of resolved) {
    if (!node) continue;

    const directEdges = await db.getSkillEdgesTo(node.id, 'PARENT_OF');
    const directDomains: Array<{ domainName: string; domainNodeId: number }> = [];
    for (const edge of directEdges) {
      const domainNode = await db.getSkillNodeById(edge.from_skill_id);
      if (domainNode) directDomains.push({ domainName: domainNode.canonical_name, domainNodeId: domainNode.id });
    }

    let frameworkParent: { skillName: string; directDomains: Array<{ domainName: string; domainNodeId: number }> } | null = null;
    const frameworkEdges = await db.getSkillEdgesFrom(node.id, 'FRAMEWORK_OF');
    if (frameworkEdges.length > 0) {
      const parentNode = await db.getSkillNodeById(frameworkEdges[0].to_skill_id);
      if (parentNode) {
        const parentDomainEdges = await db.getSkillEdgesTo(parentNode.id, 'PARENT_OF');
        const parentDirectDomains: Array<{ domainName: string; domainNodeId: number }> = [];
        for (const edge of parentDomainEdges) {
          const domainNode = await db.getSkillNodeById(edge.from_skill_id);
          if (domainNode) parentDirectDomains.push({ domainName: domainNode.canonical_name, domainNodeId: domainNode.id });
        }
        frameworkParent = { skillName: parentNode.canonical_name, directDomains: parentDirectDomains };
      }
    }

    const satisfactions = resolveSkillDomains(node.canonical_name, directDomains, frameworkParent).map((s) => ({ ...s, satisfyingSkillNodeId: node.id }));
    conclusions.push(...satisfactions.map((s) => satisfactionToDraftConclusion(s, subjectType)));
  }

  return conclusions;
}
