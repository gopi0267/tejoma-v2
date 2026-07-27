/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConfidenceProfile } from './matching/confidenceService.js';

export interface User {
  id: number;
  email: string | null;
  phone: string | null;
  password_hash: string;
  company_id: number;
  role: 'recruiter' | 'admin' | 'superadmin' | 'candidate';
  is_active: boolean;
  name: string;
  created_at: string;
  updated_at: string;
  // User Management audit trail (see migration-user-management.sql) - all null on rows that
  // predate the feature (signup-created users, whose "creator" is themselves).
  deleted_at?: string | null;
  created_by?: number | null;
  updated_by?: number | null;
  disabled_by?: number | null;
  password_reset_by?: number | null;
  last_login_at?: string | null;
}

export interface CompanyRegistrationRequest {
  id: number;
  company_name: string;
  company_website: string | null;
  industry: string | null;
  company_size: string | null;
  business_email: string;
  company_phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  admin_name: string;
  admin_email: string;
  admin_phone: string | null;
  password_hash: string;
  status: 'pending' | 'approved' | 'rejected';
  review_notes: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  resulting_company_id: number | null;
  resulting_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: number;
  name: string;
  industry: string;
  plan: 'starter' | 'pro' | 'enterprise';
  seats_limit: number;
  is_active: boolean;
  company_slug: string;
  logo_url: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
}

// A self-owned candidate identity, independent of any company (see migration-candidate-accounts.sql
// and the approved Marketplace Transformation Blueprint) - deliberately not an extension of User
// (which requires company_id) or of Candidate below (the unrelated, recruiter-owned resume record).
export interface CandidateAccount {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  is_active: boolean;
  deleted_at?: string | null;
  headline: string | null;
  skills: string[] | null;
  years_of_experience: string | null;
  location: string | null;
  education: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
  onboarding_completed_at?: string | null;
  current_company?: string | null;
  certifications?: string[] | null;
  tools?: string[] | null;
  languages?: string[] | null;
  notice_period?: string | null;
  current_ctc?: string | null;
  expected_ctc?: string | null;
  open_to_work?: boolean;
  visible_to_recruiters?: boolean;
  course_name?: string | null;
  course_type?: string | null;
  specialization?: string | null;
  institution_name?: string | null;
  start_year?: string | null;
  end_year?: string | null;
  grading_system?: string | null;
  grade_value?: string | null;
  primary_skill?: string | null;
  secondary_skills?: string[] | null;
  resume_file_path?: string | null;
  resume_original_filename?: string | null;
  resume_file_uploaded_at?: string | null;
  current_job_title?: string | null;
  projects?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
}

// One-to-many work history entry ("Add Experience" in the onboarding wizard) - deliberately a
// separate table from candidate_accounts since a candidate can have any number of these,
// unlike every other candidate_accounts field which is single-valued.
export interface CandidateExperience {
  id: number;
  candidate_account_id: number;
  job_title: string | null;
  company: string | null;
  employment_type: string | null;
  experience_years: number | null;
  experience_months: number | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  notice_period: string | null;
  current_location: string | null;
  preferred_location: string | null;
  key_responsibilities: string | null;
  skills_used: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: number;
  company_id: number;
  name: string;
  email: string;
  phone: string;
  skills: string[];
  primary_skills: string;
  secondary_skills: string;
  years_of_experience: string;
  current_location: string;
  preferred_location: string;
  current_company: string;
  previous_companies: string[];
  current_job_title: string;
  industry_domain: string;
  education: string;
  highest_qualification: string;
  graduation_year: string;
  university: string;
  certifications: string[];
  projects: string;
  technical_tools: string;
  languages_known: string;
  current_ctc: string;
  expected_ctc: string;
  notice_period: string;
  willingness_to_relocate: string;
  linkedin_url: string;
  github_or_portfolio_url: string;
  resume_summary: string;
  resume_text: string;
  ai_confidence_score: string;
  created_at?: string;
  updated_at?: string;
  extraction_status?: string;
  resume_file_path?: string;
  candidate_hash?: string;
  resume_embedding?: number[];
  // Enterprise AI Matching Architecture, Phase 1 - additive, not yet read by src/services.ts's
  // scoring. confidence_profile is computed by src/matching/confidenceService.ts at creation
  // time from already-parsed data (parser.service.ts itself is untouched). The three *_embedding
  // fields are precomputed alongside resume_embedding above (untouched) by
  // src/matching/embeddingIndex.ts, using the same embedding model/service, over narrower text
  // slices (skills list / responsibilities text / title) instead of the whole document.
  confidence_profile?: ConfidenceProfile | Record<string, unknown> | null;
  skills_embedding?: number[] | null;
  responsibilities_embedding?: number[] | null;
  title_embedding?: number[] | null;
  // Enterprise AI Matching Architecture, Phase 5 prerequisite - additive, dated structured data
  // the flat projects/current_company/previous_companies fields above never captured. Populated
  // by parser.service.ts (extended, not replaced - those flat fields are untouched and remain
  // what every pre-existing caller reads). Null for any candidate parsed before this phase until
  // re-parsed. See migration-phase5-structured-history.sql for the full field-shape doc.
  work_history?: WorkHistoryEntry[] | null;
  project_entries?: ProjectEntry[] | null;
  // Enterprise AI Matching Architecture, §2.3 Project Intelligence Graph - additive, computed in
  // the background after creation by src/matching/projectIntelligence.ts. Null until that runs.
  project_intelligence?: import('./matching/projectIntelligence.js').ProjectAnalysis[] | null;
}

export interface WorkHistoryEntry {
  // Null (not a fabricated empty string) when the resume states one but not the other for a
  // given block - rare, but more honest than guessing.
  company: string | null;
  title: string | null;
  // "YYYY-MM", "YYYY", or null when the resume doesn't state a parseable date.
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

export interface ProjectEntry {
  name: string | null;
  description: string;
  technologies: string[];
  start_date: string | null;
  end_date: string | null;
}

export interface Job {
  id: number;
  company_id: number;
  title: string;
  description: string;
  required_skills: string[];
  experience_years: number;
  location: string;
  salary_min: number;
  salary_max: number;
  status: 'open' | 'closed' | 'on_hold';
  created_at: string;
  updated_at: string;
  // JD-parser fields (see migration-job-description-fields.sql) - all optional/nullable since
  // they're only populated when a job is created from a parsed job description.
  optional_skills?: string[];
  min_experience?: number | null;
  max_experience?: number | null;
  experience_unit?: 'years' | 'months' | null;
  remote_type?: 'remote' | 'hybrid' | 'onsite' | null;
  employment_type?: 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance' | 'temporary' | null;
  industry?: string | null;
  department?: string | null;
  education?: string[];
  certifications?: string[];
  salary_currency?: 'INR' | 'USD' | 'EUR' | 'GBP' | null;
  notice_period?: string | null;
  number_of_openings?: number | null;
  required_languages?: string[];
  responsibilities?: string[];
  tech_stack?: Record<string, string[]>;
  keywords?: string[];
  job_summary?: string | null;
  source_raw_text?: string | null;
  parse_confidence?: Record<string, string>;
  // BERT embedding of `description`, precomputed once at creation time (see
  // migration-matching-embeddings.sql and src/algorithms/bert-embeddings.ts). Null until the
  // matching-ml-service has embedded it (or if that service was unreachable at creation time).
  description_embedding?: number[] | null;
  // Enterprise AI Matching Architecture, Phase 1 - additive, mirrors the Candidate fields above.
  skills_embedding?: number[] | null;
  responsibilities_embedding?: number[] | null;
  title_embedding?: number[] | null;
}

// Enterprise AI Matching Architecture, Phase 1 - Skill Intelligence Platform. One row per
// canonical skill, seeded from src/jd-parser/dictionaries/skills.dictionary.ts. Not yet read by
// src/services.ts's live scoring (Phase 2 work) - see src/matching/skillIntelligence.ts.
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
  // Enterprise AI Matching Architecture, Phase 4 - additive. Used by Unknown Skill Discovery's
  // nearest-neighbor search (src/matching/unknownSkillDiscovery.ts); null for any skill node
  // seeded before this phase until a backfill populates it.
  embedding?: number[] | null;
}

// Typed relationship types populated in Phase 1. RUNS_ON/DATABASE_FOR are supported by the
// skill_edges table but intentionally not populated this phase (no verifiable seed data) - kept
// out of this union deliberately so nothing in Phase 1 code can silently write an unpopulated,
// undocumented type; widen this union in the phase that actually populates them.
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

// Enterprise AI Matching Architecture, Phase 4 - Unknown Skill Discovery (architecture doc §5).
// One row per distinct unresolved token ever encountered while parsing a resume/JD; see
// src/matching/unknownSkillDiscovery.ts for the pipeline that creates/updates these.
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

// Enterprise AI Matching Architecture, Phase 1 - Role Intelligence Platform. One row per role
// archetype, seeded with the 9 roles from the architecture document. role_key is a stable slug so
// future roles are a data insert (upsertRoleProfile), never a schema change.
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

export interface Swipe {
  id: number;
  company_id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: 0 | 1 | 0.5; // 0=reject, 1=accept, 0.5=save
  match_score: number;
  timestamp: string;
  used_for_training: boolean;
  // Recruiter Review fields (see migration-recruiter-review.sql) - both null on every swipe
  // recorded before that migration, and reason stays null on normal (non-decision-change) swipes.
  reason?: string | null;
  breakdown?: MatchBreakdown | null;
  // Decision-timing capture (see migration-analytics-decision-timing.sql) - null on every swipe
  // recorded before SwipeInterface started sending it, surfaced as "N/A" in Analytics Hub.
  decision_time_seconds?: number | null;
}

export interface RecruiterNote {
  id: number;
  company_id: number;
  candidate_id: number;
  job_id: number;
  note: string;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchScore {
  id: number;
  company_id: number;
  job_id: number;
  candidate_id: number;
  feature_score: number; // 0-100
  embedding_score: number; // 0-100
  ml_score: number; // 0-100
  final_score: number; // 0-100
  rank: number;
  created_at: string;
}

export interface ModelVersion {
  id: number;
  version: string;
  accuracy: number;
  training_examples: number;
  trained_at: string;
  is_active: boolean;
}

export interface DailyStat {
  id: number;
  recruiter_id: number;
  swipes_count: number;
  acceptance_rate: number;
  date: string;
}

// ==================== Enterprise AI Matching Architecture, Phase 3 ====================

// Feature Store - one row per (job, candidate) scoring event, storing the exact 8-dimensional
// vector fed to the ML ensemble at that moment (see FEATURE_NAMES in
// python-services/matching-ml-service/ensemble.py; field order below matches it). Append-only,
// never updated - see src/matching/featureStore.ts.
export interface MatchFeatureRecord {
  id: number;
  company_id: number;
  job_id: number;
  candidate_id: number;
  feature_schema_version: number;
  jaccard_skill_score: number;
  cosine_text_score: number;
  cosine_bert_score: number;
  euclidean_feature_score: number;
  experience_score: number;
  location_score: number;
  salary_score: number;
  levenshtein_title_score: number;
  weighting: 'static' | 'dynamic';
  tier: 'heuristic' | 'full';
  model_version: string | null;
  source: string;
  computed_at: string;
}

// Learning-to-Rank - deliberately separate from ModelVersion (the production classification
// ensemble). Records isolated training runs of the new grouped XGBRanker/LGBMRanker models -
// never read by live scoring this phase. See src/matching/learningToRank.ts.
export interface LtrModelVersion {
  id: number;
  version: string;
  // Open string, not a fixed union (same "future types are a data insert, not a schema/type
  // change" reasoning as SkillRelationshipType) - ranker.py trains XGBRanker + LGBMRanker
  // jointly as one ensemble per run, same as ensemble.py's classifier, so a single row
  // describes 'xgboost_ranker+lightgbm_ranker' today; a future single-algorithm or additional-
  // algorithm run can record its own descriptive value without a type change.
  algorithm: string;
  training_examples: number;
  training_groups: number;
  ndcg_at_10: number | null;
  trained_at: string;
  is_active: boolean;
}

// Evaluation Framework - historical record of a ranking-quality evaluation run. See
// src/matching/evaluation.ts.
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

// Custom Payloads and UI States
export interface MatchBreakdown {
  skills: { score: number; matched: string[]; missing: string[] };
  experience: { score: number; candidate: number; required: number };
  location: { score: number; candidate: string; required: string; distance: number };
  salary: { score: number; expectation: number; min: number; max: number };
  // Additional similarity signals (all 0-100) - optional so any existing frontend code reading
  // just the 4 fields above keeps working unchanged.
  similarity?: {
    jaccardSkills: number;
    cosineText: number;
    cosineBert: number | null; // null if either side has no stored BERT embedding yet
    euclideanFeatures: number;
    levenshteinTitle: number;
  };
  ensemble?: {
    randomForest: number;
    xgboost: number;
    lightgbm: number;
    blendWeight: number; // 0-1, how much the final score trusted ML vs the heuristic
    trainedSampleCount: number;
  } | null; // null if the ML service was unavailable/untrained for this scoring call
  // Enterprise AI Matching Architecture, Phase 2 - only present when a caller explicitly opts
  // into dynamic weighting (matchingApi.ts's `weighting: 'dynamic'` option); absent for every
  // existing call site, which keeps reading skills/experience/location/salary above exactly as
  // before. See src/matching/explainability.ts.
  explanation?: import('./matching/explainability.js').MatchExplanation;
}

export interface QueueCandidate extends Candidate {
  match_score: number;
  breakdown: MatchBreakdown;
}

export interface DashboardStats {
  totalSwipesToday: number;
  acceptanceRate: number;
  totalCandidatesReviewed: number;
  pendingCandidates: number;
  swipesTrend: { date: string; swipes: number }[];
  recentActivity: {
    id: number;
    recruiterName: string;
    candidateName: string;
    jobTitle: string;
    action: 'accept' | 'reject' | 'save';
    timestamp: string;
  }[];
  // Dashboard-only additions (see migration-analytics-decision-timing.sql era work) - nullable
  // when there's no real basis to compute them, never a fabricated number.
  swipesYesterday?: number;
  swipesTodayChangePct?: number | null;
  modelAccuracy?: number | null;
}

export interface RecruiterAnalytics {
  id: number;
  name: string;
  email: string;
  swipesCount: number;
  acceptanceRate: number;
  averageMatchScore: number;
  avgTimeSpentSeconds: number;
}

export interface ModelConfig {
  activeModelType: 'heuristic' | 'ml_tree' | 'random_forest' | 'hybrid_weighted';
  isRetrainingInProgress: boolean;
  lastTrainingTimestamp: string;
}

// ==================== Enterprise AI Matching Architecture, Phase 8 - §2.4 Career Intelligence ====================
// See migration-phase8-career-intelligence.sql and src/matching/careerIntelligence/*.ts.

export type SeniorityLevel = 'entry' | 'mid' | 'senior' | 'staff' | 'principal' | 'manager' | 'director' | 'unknown';
export type ProgressionType = 'ic_track' | 'management_track' | 'mixed' | 'unclear';
export type SeniorityTrend = 'ascending' | 'stable' | 'descending' | 'unclear';
export type TenurePattern = 'stable' | 'short' | 'variable' | 'unclear';
export type TransitionType = 'promotion' | 'lateral_move' | 'domain_pivot' | 'specialization' | 'generalization' | 'unknown';

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

export interface CareerTransition {
  fromRole: string | null;
  toRole: string | null;
  fromSeniority: SeniorityLevel;
  toSeniority: SeniorityLevel;
  type: TransitionType;
  confidence: number;
  reasoning: string;
  timeInPreviousRoleMonths: number | null;
}

// Dates and duration ONLY - never annotated with an inferred cause. See
// src/matching/careerIntelligence/stability.ts's fairness-critical module doc.
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

export interface PredictedRole {
  roleProfileId: number | null;
  roleName: string;
  confidence: number;
  reasoning: string;
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
  transitions: CareerTransition[] | null;
  avg_tenure_months: number | null;
  median_tenure_months: number | null;
  tenure_pattern: TenurePattern | null;
  gaps: EmploymentGap[] | null;
  domain_concentration: number | null;
  domains: DomainBreakdown[] | null;
  trajectory_embedding: number[] | null;
  predicted_next_roles: PredictedRole[] | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Enterprise AI Matching Architecture, Phase 9 - §5.1 AI Reasoning Layer.
//
// Explicit, traceable, graph-constrained inference over Skill Intelligence (§1), Project
// Intelligence Graph (§2.3), and Role Intelligence (§2) - never free-form LLM inference (see
// src/matching/reasoning/computeReasoning.ts's module doc comment for the full scope note,
// including which parts of the original spec were corrected against real seed data).
// ============================================================================

export type ReasoningType = 'semantic' | 'concept' | 'causal' | 'hierarchical' | 'technology_relationship';
export type ConclusionSubjectType = 'candidate' | 'job';

// One link in a conclusion's proof path. `edge` is populated when the step corresponds to a real
// skill_edges row; `verified` is always true in this phase (every step is built directly from a
// DB read, never asserted) - kept as an explicit field so a future phase that admits softer
// evidence has somewhere to record `false` without a shape change.
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
// see computeReasoning.ts.
export interface DraftConclusion {
  conclusion_text: string;
  conclusion_type: string;
  reasoning_type: ReasoningType;
  evidence_chain: EvidenceStep[];
  conclusion_confidence: number;
  confidence_derivation: string;
  derived_from: string;
}

