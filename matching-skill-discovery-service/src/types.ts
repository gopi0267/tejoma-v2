// Ported from the monolith's src/types.ts - only the types Unknown Skill Discovery and its
// skill_nodes dependency need (Batch 27). Byte-identical shapes.

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

export interface SkillDiscoveryNeighbor {
  skillNodeId: number;
  canonicalName: string;
  similarity: number;
}

export type SkillDiscoveryStatus = 'pending' | 'auto_promoted' | 'approved' | 'rejected' | 'not_a_skill';

export interface SkillDiscoveryProposal {
  id: number;
  raw_token: string;
  normalized_token: string;
  source_type: 'resume' | 'jd';
  context_text: string | null;
  mention_count: number;
  is_skill: boolean | null;
  proposed_category: string | null;
  nearest_neighbors: SkillDiscoveryNeighbor[] | null;
  proposed_relationship_type: SkillRelationshipType | null;
  proposed_related_skill_id: number | null;
  confidence: number | null;
  status: SkillDiscoveryStatus;
  promoted_skill_node_id: number | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: number | null;
}
