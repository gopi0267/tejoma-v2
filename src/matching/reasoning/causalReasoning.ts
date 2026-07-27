// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 4: Causal Reasoning.
//
// The original spec proposed a new hand-curated CAUSAL_RULES list ("built RAG system" implies
// "vector_similarity_retrieval") parsed fresh from project text. That would duplicate work
// §2.3 Project Intelligence Graph (src/matching/projectIntelligence.ts) already does correctly:
// analyzeProjectEntries() already walks real, curated USES/FRAMEWORK_OF one-hop edges from each
// project's explicit technologies to find implied skills (e.g. Kubernetes USES Docker), with its
// own evidence (viaSkill + relationshipType) already attached. It also would have needed facts
// this codebase's skill dictionary can't support - there is no "vector_similarity_retrieval" skill
// node, and CrewAI/LangGraph/AutoGen/RAG aren't in the dictionary at all, so the spec's own worked
// example can't be reproduced honestly.
//
// This module is therefore a thin, honest promotion layer: it takes Project Intelligence's
// already-computed, already-real implied skills and turns each into a named, evidence-chained,
// auditable Reasoning Conclusion - the genuinely new value Phase 9 adds is the "conclusion" framing
// (confidence, corroboration across multiple projects, explicit filtering of anything the
// candidate already listed) on top of data that already existed, not a new inference mechanism.
//
// Candidate-only in this phase: jobs have no project_entries-equivalent structure to reason over.

import { analyzeProjectEntries } from '../projectIntelligence.js';
import type { DraftConclusion, EvidenceStep, ProjectEntry, SkillRelationshipType } from '../../types.js';

export interface CausalImplicationSource {
  viaSkill: string;
  relationshipType: SkillRelationshipType;
  projectName: string | null;
}

export interface AggregatedImplication {
  impliedSkillName: string;
  sources: CausalImplicationSource[];
}

// Pure - groups raw (impliedSkill, viaSkill, relationshipType, project) tuples by implied skill
// name, then drops anything the candidate already explicitly listed (a causal inference is only
// meaningful for a skill the candidate never stated).
export function aggregateImplications(
  tuples: Array<{ impliedSkillName: string } & CausalImplicationSource>,
  explicitSkillNames: string[]
): AggregatedImplication[] {
  const explicitLower = new Set(explicitSkillNames.map((s) => s.toLowerCase().trim()));
  const byName = new Map<string, AggregatedImplication>();

  for (const t of tuples) {
    if (explicitLower.has(t.impliedSkillName.toLowerCase().trim())) continue;
    let agg = byName.get(t.impliedSkillName);
    if (!agg) {
      agg = { impliedSkillName: t.impliedSkillName, sources: [] };
      byName.set(t.impliedSkillName, agg);
    }
    const dup = agg.sources.some((s) => s.viaSkill === t.viaSkill && s.relationshipType === t.relationshipType && s.projectName === t.projectName);
    if (!dup) agg.sources.push({ viaSkill: t.viaSkill, relationshipType: t.relationshipType, projectName: t.projectName });
  }

  return Array.from(byName.values());
}

// Pure - USES/FRAMEWORK_OF are both "hand-verified, conservative" facts (skillIntelligence.ts's
// own framing), so both start at the same strong base confidence; multiple independent
// corroborating projects/technologies raise it further, capped at 1.0.
export function implicationsToDraftConclusions(implications: AggregatedImplication[]): DraftConclusion[] {
  return implications.map((impl) => {
    const confidence = Math.min(1, 0.9 + (impl.sources.length - 1) * 0.05);
    const evidenceChain: EvidenceStep[] = impl.sources.map((s, idx) => ({
      step: idx + 1,
      statement: s.projectName
        ? `"${s.viaSkill}" ${s.relationshipType} "${impl.impliedSkillName}" (from project "${s.projectName}")`
        : `"${s.viaSkill}" ${s.relationshipType} "${impl.impliedSkillName}"`,
      source: 'project_intelligence_graph',
      edge: { from: s.viaSkill, to: impl.impliedSkillName, type: s.relationshipType },
      verified: true,
    }));

    return {
      conclusion_text: `Candidate's project work implies familiarity with "${impl.impliedSkillName}"`,
      conclusion_type: 'implied_skill',
      reasoning_type: 'causal',
      evidence_chain: evidenceChain,
      conclusion_confidence: Number(confidence.toFixed(4)),
      confidence_derivation: `${impl.sources.length} corroborating technical-dependency edge(s) (USES/FRAMEWORK_OF), never explicitly listed by the candidate`,
      derived_from: 'project_intelligence_graph',
    } satisfies DraftConclusion;
  });
}

// Orchestration - reuses Phase 6's analyzeProjectEntries verbatim, flattens its impliedSkills
// output across every project, tags each with the project it came from, then delegates to the
// pure functions above.
export async function inferCausalImplications(
  projectEntries: ProjectEntry[] | null | undefined,
  explicitSkillNames: string[]
): Promise<DraftConclusion[]> {
  const analyses = await analyzeProjectEntries(projectEntries);
  const tuples: Array<{ impliedSkillName: string } & CausalImplicationSource> = [];

  for (const analysis of analyses) {
    for (const implied of analysis.impliedSkills) {
      tuples.push({
        impliedSkillName: implied.canonicalName,
        viaSkill: implied.viaSkill,
        relationshipType: implied.relationshipType,
        projectName: analysis.projectName,
      });
    }
  }

  return implicationsToDraftConclusions(aggregateImplications(tuples, explicitSkillNames));
}
