// Enterprise AI Matching Architecture, §5.1 AI Reasoning Layer - Module 6: Orchestrating
// Pipeline.
//
// Runs all five reasoning modules over one subject (a candidate's skills + project_entries, or a
// job's required + optional skills) and stores the resulting conclusions as one replaced set
// (see db.replaceReasoningConclusions). Same fire-and-forget-after-creation/update background
// pattern already used by unknownSkillDiscovery.ts, projectIntelligence.ts, and
// computeCareerTrajectory.ts - never blocks or fails the request that triggered it.
//
// SCOPE BOUNDARY, SAME AS §2.1/§2.4: this phase computes and stores real, queryable, auditable
// reasoning conclusions (db.getReasoningConclusions). It does NOT wire any of it into live
// Dynamic Weighting (§3), matching scores, or the Explainability layer - that is a live-behavior
// change to production matching, deliberately left for a future, explicitly-instructed phase (see
// this phase's own spec, "Next phase options" C: "Wire §5.1 Reasoning conclusions into
// Explainability layer").
//
// Causal Reasoning (Module 4) only applies to candidates - jobs have no project_entries-equivalent
// structure to reason over, so a job's reasoning set is Semantic + Concept + Hierarchical +
// Technology Relationship only.

import { db } from '../../db.js';
import { logger } from '../../utils/logger.js';
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

export function computeReasoningForCandidateInBackground(
  candidateId: number,
  skills: string[] | null | undefined,
  projectEntries: ProjectEntry[] | null | undefined
): void {
  computeReasoningForCandidate(candidateId, skills, projectEntries).catch((err) =>
    logger.warn({ err: err.message, candidateId }, 'Reasoning Layer computation failed for candidate')
  );
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

export function computeReasoningForJobInBackground(jobId: number, requiredSkills: string[] | null | undefined, optionalSkills: string[] | null | undefined): void {
  computeReasoningForJob(jobId, requiredSkills, optionalSkills).catch((err) =>
    logger.warn({ err: err.message, jobId }, 'Reasoning Layer computation failed for job')
  );
}
