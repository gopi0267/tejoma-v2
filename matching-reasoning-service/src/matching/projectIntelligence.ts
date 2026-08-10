// Ported from the monolith's src/matching/projectIntelligence.ts - analyzeProject/
// analyzeProjectEntries/findImpliedSkills only (byte-identical), the read-only slice
// causalReasoning.ts needs. The monolith's computeAndStoreProjectIntelligence(InBackground)
// (writes candidates.project_intelligence) is a separate, unrelated concern - not ported here, and
// not part of the AI Reasoning Layer's own scope (Batch 26 domain audit).
import { db } from '../db.js';
import { canonicalizeSkill } from './skillLookup.js';
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
  viaSkill: string;
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

  for (const raw of project.technologies || []) {
    const node = await canonicalizeSkill(raw);
    explicitSkills.push({ raw, canonicalSkillId: node?.id ?? null, canonicalName: node?.canonical_name ?? null });
    if (node) knownIds.add(node.id);
  }

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
