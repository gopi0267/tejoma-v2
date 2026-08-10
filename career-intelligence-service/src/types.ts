// Ported from the monolith's src/types.ts - only the types Career Intelligence Service needs.
// Byte-identical shapes.

export interface WorkHistoryEntry {
  company: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
}

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

// Dates and duration ONLY - never annotated with an inferred cause. See stability.ts's
// fairness-critical module doc.
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
