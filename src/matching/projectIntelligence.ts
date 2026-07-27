// Enterprise AI Matching Architecture, §2.3 - Project Intelligence Graph.
//
// Decomposes each project_entries item (Phase 5 prerequisite) into the technologies a candidate
// explicitly named PLUS technologies genuinely implied by well-established tool-dependency facts
// already curated in the Skill Intelligence Platform (Phase 1's USES/FRAMEWORK_OF edges - e.g.
// "Kubernetes USES Docker"). This is the single most direct fix to a well-known failure mode of
// flat skills-list matching: candidates routinely undersell themselves by not listing every
// library/tool a project genuinely required.
//
// SCOPE BOUNDARY, DELIBERATE: this is graph-edge traversal over already-curated, real facts - ONE
// hop from each explicit technology, never chained multi-hop causal inference. The architecture
// doc's own worked example (AI Chatbot -> LLM -> RAG -> Vector Database -> FastAPI -> Docker ->
// AWS) is presented under §5.1 AI Reasoning Layer, a distinct, LLM-assisted, multi-hop capability
// that does not exist yet. Implying JavaScript from React via a real curated FRAMEWORK_OF edge is
// defensible; chaining five hops of inference with no LLM reasoning step to justify each link is
// not - so this module deliberately stops at one hop.
//
// RELATED_TO/COMMONLY_WITH are deliberately excluded from implication - "known alternative to" or
// "co-occurs with" is not the same claim as "necessarily requires", and using them here would
// overclaim what the underlying edge actually establishes.
//
// Every implied skill is tagged with the specific relationship that justified it (a real, if
// simple, evidence chain) and is NEVER written into candidates.skills/skills_array - it stays a
// separate, clearly-provenanced enrichment, matching the "never silently promoted to the same
// status as an explicitly-listed skill" rule this codebase already applies to Unknown Skill
// Discovery's emerging skills and the Confidence Architecture's inferred fields.

import { db } from '../db.js';
import { logger } from '../utils/logger.js';
import { canonicalizeSkill } from './skillIntelligence.js';
import type { ProjectEntry, SkillRelationshipType } from '../types.js';

const IMPLICATION_RELATIONSHIP_TYPES: SkillRelationshipType[] = ['USES', 'FRAMEWORK_OF'];

export interface ExplicitProjectSkill {
  raw: string;
  canonicalSkillId: number | null;
  canonicalName: string | null;
}

export interface ImpliedProjectSkill {
  canonicalSkillId: number;
  canonicalName: string;
  viaSkill: string; // the explicit technology whose graph edge produced this inference
  relationshipType: SkillRelationshipType;
}

export interface ProjectAnalysis {
  projectName: string | null;
  explicitSkills: ExplicitProjectSkill[];
  impliedSkills: ImpliedProjectSkill[];
}

async function findImpliedSkills(
  canonicalSkillId: number,
  canonicalSkillName: string,
  alreadyKnownIds: Set<number>
): Promise<ImpliedProjectSkill[]> {
  const implied: ImpliedProjectSkill[] = [];
  for (const relationshipType of IMPLICATION_RELATIONSHIP_TYPES) {
    const edges = await db.getSkillEdgesFrom(canonicalSkillId, relationshipType);
    for (const edge of edges) {
      // Already explicit in this project, or already implied via an earlier technology - no
      // duplicate entries for the same skill within one project's analysis.
      if (alreadyKnownIds.has(edge.to_skill_id)) continue;
      const targetNode = await db.getSkillNodeById(edge.to_skill_id);
      if (!targetNode) continue;
      implied.push({ canonicalSkillId: targetNode.id, canonicalName: targetNode.canonical_name, viaSkill: canonicalSkillName, relationshipType });
      alreadyKnownIds.add(targetNode.id);
    }
  }
  return implied;
}

export async function analyzeProject(project: ProjectEntry): Promise<ProjectAnalysis> {
  const explicitSkills: ExplicitProjectSkill[] = [];
  const knownIds = new Set<number>();

  // Pass 1: canonicalize every explicit technology and seed knownIds, so pass 2 never proposes an
  // already-explicit skill as merely "implied".
  for (const raw of project.technologies || []) {
    const node = await canonicalizeSkill(raw);
    explicitSkills.push({ raw, canonicalSkillId: node?.id ?? null, canonicalName: node?.canonical_name ?? null });
    if (node) knownIds.add(node.id);
  }

  // Pass 2: one-hop implication from each explicit, canonicalized technology.
  const impliedSkills: ImpliedProjectSkill[] = [];
  for (const skill of explicitSkills) {
    if (!skill.canonicalSkillId || !skill.canonicalName) continue;
    impliedSkills.push(...(await findImpliedSkills(skill.canonicalSkillId, skill.canonicalName, knownIds)));
  }

  return { projectName: project.name, explicitSkills, impliedSkills };
}

export async function analyzeProjectEntries(projectEntries: ProjectEntry[] | null | undefined): Promise<ProjectAnalysis[]> {
  const results: ProjectAnalysis[] = [];
  for (const project of projectEntries || []) {
    results.push(await analyzeProject(project));
  }
  return results;
}

// ==================== BACKGROUND COMPUTATION + STORAGE ====================
// Same fire-and-forget-after-creation pattern as embeddingIndex.ts/unknownSkillDiscovery.ts -
// never blocks or fails the candidate creation response.
export async function computeAndStoreProjectIntelligence(
  candidateId: number,
  companyId: number,
  projectEntries: ProjectEntry[] | null | undefined
): Promise<void> {
  if (!projectEntries || projectEntries.length === 0) return;
  const analysis = await analyzeProjectEntries(projectEntries);
  await db.updateCandidate(candidateId, { project_intelligence: analysis }, companyId);
}

export function computeAndStoreProjectIntelligenceInBackground(
  candidateId: number,
  companyId: number,
  projectEntries: ProjectEntry[] | null | undefined
): void {
  computeAndStoreProjectIntelligence(candidateId, companyId, projectEntries).catch((err) =>
    logger.warn({ err: err.message, candidateId }, 'Project Intelligence analysis failed')
  );
}
