// Ported from the monolith's src/types.ts - only the types the AI Reasoning Layer and its
// skill_nodes/skill_edges dependency need (Batch 26). Byte-identical shapes.

export interface ProjectEntry {
  name: string | null;
  description: string;
  technologies: string[];
  start_date: string | null;
  end_date: string | null;
}

export interface SkillNode {
  id: number;
  canonical_name: string;
  category: string;
  technology_domain: string | null;
  aliases: string[];
  popularity_score: number;
  confidence: number;
  is_deprecated: boolean;
  is_emerging: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  embedding?: number[] | null;
}

export type SkillRelationshipType = 'PARENT_OF' | 'FRAMEWORK_OF' | 'RELATED_TO' | 'USES' | 'COMMONLY_WITH';

export interface SkillEdge {
  id: number;
  from_skill_id: number;
  to_skill_id: number;
  relationship_type: SkillRelationshipType;
  weight: number;
  source: string;
  created_at: string;
}

export type ConclusionSubjectType = 'candidate' | 'job';

export type ReasoningType = 'semantic' | 'concept' | 'causal' | 'hierarchical' | 'technology_relationship';

export interface EvidenceStep {
  step: number;
  statement: string;
  source: string;
  edge?: { from: string; to: string; type: SkillRelationshipType } | null;
  verified: boolean;
}

export interface ReasoningConclusion {
  id: number;
  subject_type: ConclusionSubjectType;
  subject_id: number;
  conclusion_text: string;
  conclusion_type: string;
  reasoning_type: ReasoningType;
  evidence_chain: EvidenceStep[];
  conclusion_confidence: number;
  confidence_derivation: string | null;
  derived_from: string;
  created_at: string;
}

// Input shape modules build before a subject_type/subject_id is attached by the orchestrator -
// see matching/reasoning/computeReasoning.ts.
export interface DraftConclusion {
  conclusion_text: string;
  conclusion_type: string;
  reasoning_type: ReasoningType;
  evidence_chain: EvidenceStep[];
  conclusion_confidence: number;
  confidence_derivation: string;
  derived_from: string;
}
