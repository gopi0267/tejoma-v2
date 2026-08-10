// Ported from the monolith's src/types.ts - only the types this service needs. Job/Candidate are
// narrowed (this service's own request DTOs, not the monolith's full types) - every endpoint here
// takes its full input directly in the request body, same "narrow, opaque-passthrough shape"
// convention as career-intelligence-service's BgeCandidateInput/BgeJobInput (Batch 28) and
// matching-evaluation-service's ShadowCandidate/ShadowJob (Batch 31).

export interface RoleProfile {
  id: number;
  role_key: string;
  display_name: string;
  mandatory_skills: string[];
  preferred_skills: string[];
  optional_skills: string[];
  common_tools: string[];
  typical_responsibilities: string[];
  preferred_certifications: string[];
  experience_band_min: number | null;
  experience_band_max: number | null;
  related_roles: string[];
  career_progression: string[];
  embedding: number[] | null;
  source: string;
  created_at: string;
  updated_at: string;
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
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
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

// This service's own narrow request DTO for a job - only the fields resolveSkillTiers/
// computeSeniorityAdjustedWeights/hybridRetrieveCandidates actually read.
export interface DynamicWeightingJob {
  id: number;
  title: string | null;
  required_skills: string[] | null;
  optional_skills: string[] | null;
  min_experience: number | null;
  experience_years: number | null;
  skills_embedding: number[] | null;
}

// This service's own narrow request DTO for a candidate - only the fields
// computeDynamicSkillScore/hybridRetrieveCandidates actually read.
export interface DynamicWeightingCandidate {
  id: number;
  skills: string[] | null;
  skills_embedding: number[] | null;
}

export type SkillTier = 'mandatory' | 'preferred' | 'optional' | 'bonus';

export interface ResolvedSkillTiers {
  mandatory: string[];
  preferred: string[];
  optional: string[];
  bonus: string[];
  roleMatch: { role: RoleProfile; similarity: number } | null;
}

export interface DynamicWeights {
  skillWeight: number;
  experienceWeight: number;
  locationWeight: number;
  salaryWeight: number;
  seniorityNote: string | null;
}

export interface SkillMatchOutcome {
  requiredSkill: string;
  tier: SkillTier;
  matchType: 'exact' | 'graph_related';
  matchedCandidateSkill: string;
  relationshipType?: SkillRelationshipType;
}

export interface DynamicSkillScoreResult {
  score: number;
  matched: SkillMatchOutcome[];
  missingMandatory: string[];
  missingOther: string[];
}

// Narrowed - only the fields buildMatchExplanation's buildConfidenceNotes actually reads. Not the
// full ConfidenceProfile from the monolith's confidenceService.ts (out of scope - see this
// service's README for why confidenceService.ts/embeddingIndex.ts are NOT ported here).
export interface ConfidenceBasis {
  level: 'high' | 'medium' | 'low';
  score: number;
  basis: string;
}

export interface ConfidenceProfile {
  overall: ConfidenceBasis;
  skills: Record<string, ConfidenceBasis>;
}

export interface MatchExplanation {
  schema_version: 1;
  matchedSkills: SkillMatchOutcome[];
  graphDerivedMatches: SkillMatchOutcome[];
  missingMandatorySkills: string[];
  missingOtherSkills: string[];
  confidenceNotes: string[];
  dynamicWeightContribution: {
    skillWeight: number;
    experienceWeight: number;
    locationWeight: number;
    salaryWeight: number;
    seniorityNote: string | null;
    skillTierWeights: { mandatory: number; preferred: number; optional: number; bonus: number };
  };
  reasoning: string;
}
