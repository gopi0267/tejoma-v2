// Ported from the monolith's src/matching/reasoning/computeReasoning.ts (Batch 26) - orchestration
// logic byte-identical; computeReasoningForCandidateInBackground/computeReasoningForJobInBackground
// are NOT ported (this service has no route-triggered background path of its own - it's invoked
// synchronously by src/routes/reasoning.routes.ts, itself called by the monolith's own
// reasoningServiceShadow.ts fire-and-forget wrapper).
//
// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 6: Orchestrating Pipeline.
//
// Runs all five reasoning modules over one subject (a candidate's skills + project_entries, or a
// job's required + optional skills) and stores the resulting conclusions as one replaced set (see
// db.replaceReasoningConclusions).
//
// SCOPE BOUNDARY, SAME AS §2.1/§2.4: this phase computes and stores real, queryable, auditable
// reasoning conclusions (db.getReasoningConclusions). It does NOT wire any of it into live
// Dynamic Weighting (§3), matching scores, or the Explainability layer.
//
// Causal Reasoning (Module 4) only applies to candidates - jobs have no project_entries-equivalent
// structure to reason over, so a job's reasoning set is Semantic + Concept + Hierarchical +
// Technology Relationship only.

import { db } from '../../db.js';
import { semanticallyResolve } from './semanticReasoning.js';
import { inferConceptsForSkills } from './conceptReasoning.js';
import { inferHierarchicalSatisfaction } from './hierarchicalReasoning.js';
import { inferCausalImplications } from './causalReasoning.js';
import { inferStackCoherence } from './technologyRelationship.js';
import type { DraftConclusion, ProjectEntry, ReasoningConclusion } from '../../types.js';

// Only the alias/embedding-neighbor tiers represent an actual inference (an exact match is just
// literal text matching, not reasoning - nothing to conclude beyond what was already stated).
async function buildSemanticDraftConclusions(rawSkillTexts: string[]): Promise<DraftConclusion[]> {
  const conclusions: DraftConclusion[] = [];
  for (const raw of rawSkillTexts || []) {
    const inference = await semanticallyResolve(raw);
    if (!inference || inference.method === 'exact') continue;
    conclusions.push({
      conclusion_text: `"${inference.originalText}" resolves to the known skill "${inference.resolvedTo}"`,
      conclusion_type: 'skill_name_resolution',
      reasoning_type: 'semantic',
      evidence_chain: inference.evidenceChain,
      conclusion_confidence: inference.confidence,
      confidence_derivation: inference.reasoning,
      derived_from: 'skill_intelligence_graph',
    });
  }
  return conclusions;
}

export async function computeReasoningForCandidate(
  candidateId: number,
  skills: string[] | null | undefined,
  projectEntries: ProjectEntry[] | null | undefined
): Promise<ReasoningConclusion[]> {
  const skillList = skills || [];

  const [semantic, concept, hierarchical, causal, techRelationship] = await Promise.all([
    buildSemanticDraftConclusions(skillList),
    inferConceptsForSkills(skillList),
    inferHierarchicalSatisfaction(skillList),
    inferCausalImplications(projectEntries, skillList),
    inferStackCoherence(skillList),
  ]);

  return db.replaceReasoningConclusions('candidate', candidateId, [...semantic, ...concept, ...hierarchical, ...causal, ...techRelationship]);
}

export async function computeReasoningForJob(
  jobId: number,
  requiredSkills: string[] | null | undefined,
  optionalSkills: string[] | null | undefined
): Promise<ReasoningConclusion[]> {
  const skillList = Array.from(new Set([...(requiredSkills || []), ...(optionalSkills || [])]));

  const [semantic, concept, hierarchical, techRelationship] = await Promise.all([
    buildSemanticDraftConclusions(skillList),
    inferConceptsForSkills(skillList, 'job'),
    inferHierarchicalSatisfaction(skillList, 'job'),
    inferStackCoherence(skillList, 'job'),
  ]);

  return db.replaceReasoningConclusions('job', jobId, [...semantic, ...concept, ...hierarchical, ...techRelationship]);
}
