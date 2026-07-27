// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 5: Technology
// Relationship Reasoning (stack coherence).
//
// Measures how much of a subject's own skill list is internally connected by real, curated
// skill_edges (FRAMEWORK_OF, RELATED_TO, COMMONLY_WITH) - the fraction of all possible skill
// pairs that have a supporting edge. The original spec asked for "red flag" judgments on
// combinations like "three competing frontend frameworks" - dropped deliberately, since nothing
// in this codebase's curated graph represents a "conflicting" relationship (RELATED_TO means
// "known alternative", not "incompatible"; knowing React AND Angular is a genuinely common,
// unremarkable profile, not a red flag). What's kept is the real, computable half of the idea: a
// coherence SCORE with an auditable evidence chain, described in neutral terms.

import { db } from '../../db.js';
import { canonicalizeSkills } from '../skillIntelligence.js';
import type { DraftConclusion, EvidenceStep, SkillRelationshipType } from '../../types.js';

// Below this many resolved skills, "coherence" isn't a meaningful measurement (1-2 skills always
// score 0% or trivially skip) - same spirit as Concept Reasoning's corroboration-count threshold.
export const MIN_SKILLS_FOR_COHERENCE = 3;
const COHERENCE_RELATIONSHIP_TYPES: SkillRelationshipType[] = ['FRAMEWORK_OF', 'RELATED_TO', 'COMMONLY_WITH'];

export interface CoherencePair {
  skillA: string;
  skillB: string;
  relationshipType: SkillRelationshipType;
}

export interface StackCoherenceResult {
  skillNames: string[];
  totalPairs: number;
  supportedPairs: CoherencePair[];
  coherenceScore: number;
}

// Pure - adjacency maps canonical skill name -> Map<other canonical skill name, relationship
// type>, already merged across both edge directions by the caller.
export function computeStackCoherence(skillNames: string[], adjacency: Map<string, Map<string, SkillRelationshipType>>): StackCoherenceResult | null {
  const unique = Array.from(new Set(skillNames));
  if (unique.length < MIN_SKILLS_FOR_COHERENCE) return null;

  const supportedPairs: CoherencePair[] = [];
  let totalPairs = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      totalPairs++;
      const type = adjacency.get(unique[i])?.get(unique[j]) ?? adjacency.get(unique[j])?.get(unique[i]);
      if (type) supportedPairs.push({ skillA: unique[i], skillB: unique[j], relationshipType: type });
    }
  }

  return { skillNames: unique, totalPairs, supportedPairs, coherenceScore: totalPairs > 0 ? Number((supportedPairs.length / totalPairs).toFixed(4)) : 0 };
}

function coherenceLabel(score: number): string {
  if (score >= 0.6) return 'a tightly connected ecosystem';
  if (score >= 0.3) return 'multiple related technology areas';
  return 'several distinct, largely unrelated technology areas';
}

// Pure - "conclusion_confidence" here measures how much evidence went into the coherence
// MEASUREMENT itself (more pairs evaluated = a more reliable score), not a claim about whether
// the coherence level is good or bad.
export function coherenceResultToDraftConclusion(result: StackCoherenceResult, subjectType: 'candidate' | 'job' = 'candidate'): DraftConclusion {
  const subjectPhrase = subjectType === 'candidate' ? "Candidate's technology stack" : "This job's required technology stack";
  const measurementConfidence = Math.min(0.95, 0.5 + result.totalPairs * 0.03);
  const evidenceChain: EvidenceStep[] = result.supportedPairs.map((p, idx) => ({
    step: idx + 1,
    statement: `"${p.skillA}" and "${p.skillB}" are connected (${p.relationshipType})`,
    source: 'skill_graph',
    edge: { from: p.skillA, to: p.skillB, type: p.relationshipType },
    verified: true,
  }));
  evidenceChain.push({
    step: evidenceChain.length + 1,
    statement: `${result.supportedPairs.length} of ${result.totalPairs} possible skill pairs are connected by a curated edge`,
    source: 'stack_coherence_aggregation',
    edge: null,
    verified: true,
  });

  return {
    conclusion_text: `${subjectPhrase} shows ${coherenceLabel(result.coherenceScore)} (coherence score ${result.coherenceScore.toFixed(2)})`,
    conclusion_type: 'stack_coherence',
    reasoning_type: 'technology_relationship',
    evidence_chain: evidenceChain,
    conclusion_confidence: Number(measurementConfidence.toFixed(4)),
    confidence_derivation: `Measured over ${result.totalPairs} skill pairs; confidence reflects how much of the stack was evaluated, not a judgment of the score itself`,
    derived_from: 'skill_intelligence_graph',
  };
}

// Orchestration - resolves raw skill text, fetches FRAMEWORK_OF/RELATED_TO/COMMONLY_WITH edges
// FROM every resolved skill, keeps only edges landing on another skill in the SAME resolved set
// (an edge to a skill the subject doesn't have tells us nothing about this subject's own
// coherence), then delegates to the pure functions above.
export async function inferStackCoherence(rawSkillTexts: string[], subjectType: 'candidate' | 'job' = 'candidate'): Promise<DraftConclusion[]> {
  const resolved = (await canonicalizeSkills(rawSkillTexts)).filter((n): n is NonNullable<typeof n> => n !== null);
  const uniqueById = new Map(resolved.map((n) => [n.id, n]));
  if (uniqueById.size < MIN_SKILLS_FOR_COHERENCE) return [];

  const idToName = new Map(Array.from(uniqueById.values()).map((n) => [n.id, n.canonical_name]));
  const adjacency = new Map<string, Map<string, SkillRelationshipType>>();

  for (const node of uniqueById.values()) {
    for (const relType of COHERENCE_RELATIONSHIP_TYPES) {
      const edges = await db.getSkillEdgesFrom(node.id, relType);
      for (const edge of edges) {
        if (!uniqueById.has(edge.to_skill_id)) continue;
        const fromName = node.canonical_name;
        const toName = idToName.get(edge.to_skill_id)!;
        if (!adjacency.has(fromName)) adjacency.set(fromName, new Map());
        adjacency.get(fromName)!.set(toName, relType);
      }
    }
  }

  const result = computeStackCoherence(Array.from(idToName.values()), adjacency);
  return result ? [coherenceResultToDraftConclusion(result, subjectType)] : [];
}
