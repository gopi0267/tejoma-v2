// This service's own DB-row shapes for swipes/recruiter_notes/detailed_scoring_reports - mirror
// the monolith's raw stored representation exactly.

export interface SwipeRow {
  id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: number | null;
  match_score: number | null;
  timestamp: string | null;
  used_for_training: boolean | null;
  company_id: number;
  reason: string | null;
  breakdown: unknown | null;
  decision_time_seconds: number | null;
}

export interface RecruiterNoteRow {
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

export interface DetailedScoringReportRow {
  id: number;
  company_id: number;
  candidate_id: number;
  job_id: number;
  report: unknown;
  generated_by: number | null;
  generated_at: string;
}

// Remaining-monolith migration, Step 6 - byte-identical to job-service's own types.ts (same
// contract: real DB rows from job-service/candidate-core-service, tier: 'full' ranking).

export interface Job {
  id: number;
  company_id: number;
  title: string;
  description: string | null;
  required_skills: string[] | null;
  experience_years: number | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  status: 'open' | 'closed' | 'on_hold';
  created_at: string;
  updated_at: string;
  optional_skills: string[] | null;
  min_experience: number | null;
  max_experience: number | null;
  experience_unit: 'years' | 'months' | null;
  remote_type: 'remote' | 'hybrid' | 'onsite' | null;
  employment_type: string | null;
  industry: string | null;
  department: string | null;
  education: string[] | null;
  certifications: string[] | null;
  salary_currency: string | null;
  notice_period: string | null;
  number_of_openings: number | null;
  required_languages: string[] | null;
  responsibilities: string[] | null;
  tech_stack: Record<string, unknown> | null;
  keywords: string[] | null;
  job_summary: string | null;
  source_raw_text: string | null;
  parse_confidence: Record<string, unknown> | null;
  description_embedding: number[] | null;
  skills_embedding: number[] | null;
  responsibilities_embedding: number[] | null;
  title_embedding: number[] | null;
}

export interface Candidate {
  id: number;
  company_id: number;
  name: string;
  skills: string[];
  years_of_experience: string;
  current_location: string;
  current_job_title: string;
  current_ctc: string;
  expected_ctc: string;
  resume_text: string;
  resume_embedding?: number[] | null;
  // Extra fields candidate-core-service's /internal/candidates/by-ids already returns (full
  // mapRowToCandidate fidelity) but the matching-focused fields above never needed - write-cutover
  // completion plan, Phase D: rubric-scoring.service.ts's prompt builder wants these too.
  current_company?: string | null;
  highest_qualification?: string | null;
  university?: string | null;
  certifications?: string[];
  projects?: string | null;
  technical_tools?: string | null;
  resume_summary?: string | null;
}

export interface MatchBreakdown {
  skills: { score: number; matched: string[]; missing: string[] };
  experience: { score: number; candidate: number; required: number };
  location: { score: number; candidate: string; required: string; distance: number };
  salary: { score: number; expectation: number; min: number; max: number };
  similarity?: {
    jaccardSkills: number;
    cosineText: number;
    cosineBert: number | null;
    euclideanFeatures: number;
    levenshteinTitle: number;
  };
  ensemble?: {
    randomForest: number;
    xgboost: number;
    lightgbm: number;
    blendWeight: number;
    trainedSampleCount: number;
  } | null;
}

export interface MatchScoreResult {
  feature_score: number;
  embedding_score: number;
  ml_score: number;
  final_score: number;
  breakdown: MatchBreakdown;
  summary: string;
  feature_vector?: number[];
}

export interface RankedCandidate {
  candidate: Candidate;
  match_score: number;
  score?: MatchScoreResult;
}
