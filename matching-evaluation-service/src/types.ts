// Ported exactly from the monolith's src/types.ts - LtrModelVersion, MatchEvaluationRun, Swipe.
// Candidate/Job are intentionally NOT the monolith's full types - this service only ever passes
// them through opaquely (received from the monolith's /internal/matching-evaluation/* proxy,
// forwarded unchanged into calculateMatchScoresBatch's own proxy call) and only ever reads `.id`
// itself, so a minimal shape avoids duplicating and needing to keep in sync a large type this
// service has no reason to interpret.

export interface LtrModelVersion {
  id: number;
  version: string;
  algorithm: string;
  training_examples: number;
  training_groups: number;
  ndcg_at_10: number | null;
  trained_at: string;
  is_active: boolean;
}

export interface MatchEvaluationRun {
  id: number;
  company_id: number;
  evaluated_at: string;
  jobs_evaluated: number;
  swipes_evaluated: number;
  k: number;
  ndcg_at_k: number | null;
  map_at_k: number | null;
  mrr: number | null;
  precision_at_k: number | null;
  recall_at_k: number | null;
  data_volume_note: string | null;
}

export interface Swipe {
  id: number;
  company_id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: 0 | 1 | 0.5;
  match_score: number;
  timestamp: string;
  used_for_training: boolean;
}

export interface OpaqueCandidate {
  id: number;
  [key: string]: unknown;
}

export interface OpaqueJob {
  id: number;
  [key: string]: unknown;
}

// Ported from the monolith's src/types.ts - ProficiencyShadowScore. career_progression_type/
// recency_role_expectation are loosened to `string | null` (vs. the monolith's narrow
// ProgressionType/RoleRecencyExpectation unions) since shadowDataHealth.ts/proficiencyAnalytics.ts
// only ever bucket these by raw string equality, never type-narrow them. skill_multipliers/
// recency_skill_multipliers/reasoning_covered_domains/reasoning_uncovered_domains are `unknown` -
// neither ported file inspects their contents, only passes the row through.
export interface ProficiencyShadowScore {
  id: number;
  company_id: number;
  candidate_id: number;
  job_id: number;
  base_match_score: number;
  proficiency_adjusted_score: number;
  overall_multiplier: number;
  skill_multipliers: unknown;
  computed_at: string;
  decision_action: number | null;
  career_multiplier: number | null;
  career_progression_signal: number | null;
  career_stability_signal: number | null;
  career_domain_signal: number | null;
  career_adjusted_score: number | null;
  career_progression_type: string | null;
  recency_multiplier: number | null;
  recency_adjusted_score: number | null;
  recency_role_expectation: string | null;
  recency_skill_multipliers: unknown;
  reasoning_multiplier: number | null;
  reasoning_adjusted_score: number | null;
  reasoning_coverage_signal: number | null;
}

// ==================== Batch 31 (shadow-weighting cluster) - ported/narrowed types ====================

export interface ProjectEntry {
  name: string | null;
  description: string;
  technologies: string[];
  start_date: string | null;
  end_date: string | null;
}

// This service's own request shape for the internal shadow-compute endpoint - the monolith's
// shadow client already has the full real Candidate/Job in memory and passes exactly these fields
// in the request body, so a narrow shape (not the monolith's full Candidate/Job) is honest here,
// same convention as career-intelligence-service's BgeCandidateInput/BgeJobInput (Batch 28).
export interface ShadowCandidate {
  id: number;
  company_id: number;
  resume_summary: string | null;
  project_entries: ProjectEntry[] | null;
  certifications: string[] | null;
}

export interface ShadowJob {
  id: number;
  title: string | null;
}

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

export type SeniorityLevel = 'entry' | 'mid' | 'senior' | 'staff' | 'principal' | 'manager' | 'director' | 'unknown';
export type ProgressionType = 'ic_track' | 'management_track' | 'mixed' | 'unclear';
export type SeniorityTrend = 'ascending' | 'stable' | 'descending' | 'unclear';
export type TenurePattern = 'stable' | 'short' | 'variable' | 'unclear';

export interface NormalizedJob {
  roleProfileId: number | null;
  title: string | null;
  company: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  durationMonths: number | null;
  inferredSeniority: SeniorityLevel;
  inferredSeniorityConfidence: number;
  domain: string | null;
}

export interface EmploymentGap {
  startDate: string;
  endDate: string;
  durationMonths: number;
}

export interface DomainBreakdown {
  domain: string;
  roleCount: number;
  totalMonths: number;
  percentage: number;
}

export interface CareerTrajectory {
  id: number;
  candidate_id: number;
  company_id: number;
  job_sequence: NormalizedJob[];
  total_career_months: number | null;
  role_count: number | null;
  progression_type: ProgressionType | null;
  seniority_level: SeniorityLevel | null;
  seniority_trend: SeniorityTrend | null;
  transitions: unknown;
  avg_tenure_months: number | null;
  median_tenure_months: number | null;
  tenure_pattern: TenurePattern | null;
  gaps: EmploymentGap[] | null;
  domain_concentration: number | null;
  domains: DomainBreakdown[] | null;
  trajectory_embedding: number[] | null;
  predicted_next_roles: unknown;
  created_at: string;
  updated_at: string;
}

export type ReasoningType = 'semantic' | 'concept' | 'causal' | 'hierarchical' | 'technology_relationship';
export type ConclusionSubjectType = 'candidate' | 'job';
export type SkillRelationshipType = 'PARENT_OF' | 'FRAMEWORK_OF' | 'RELATED_TO' | 'USES' | 'COMMONLY_WITH';

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

export type ProficiencyTierMatchType = 'exceeds' | 'meets' | 'below';

export interface SkillProficiencyMultiplier {
  skillName: string;
  multiplier: number;
  candidateTier: string;
  expectedTier: string;
  matchType: ProficiencyTierMatchType;
  confidence: number;
  reasoning: string;
}

export interface CareerMultiplierResult {
  multiplier: number;
  progressionSignal: number;
  stabilitySignal: number;
  domainSignal: number;
  confidence: number;
  reasoning: string;
}

export type RoleRecencyExpectation = 'high' | 'medium' | 'low';

export interface SkillRecencyMultiplier {
  skillName: string;
  multiplier: number;
  monthsSinceUse: number | null;
  skillCategory: string | null;
  confidence: number;
  reasoning: string;
}

export interface ReasoningMultiplierResult {
  multiplier: number;
  densitySignal: number;
  coverageSignal: number;
  qualitySignal: number;
  coveredDomains: string[];
  uncoveredDomains: string[];
  confidence: number;
  reasoning: string;
}
