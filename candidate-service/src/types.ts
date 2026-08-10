// Ported exactly from the monolith's src/types.ts - CandidateAccount, CandidateExperience, and
// CandidateNotification (Batch 20 - see migrations/002_candidate_notifications.up.sql's header
// comment for why this table lives here rather than a new service).

export interface CandidateNotification {
  id: number;
  candidate_account_id: number;
  match_id: number | null;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
  job_id: number | null;
}

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

// Remaining-monolith migration, Step 5 - trimmed to exactly what candidate-search.routes.ts's
// synthetic-object adapters (toSyntheticJobFromQuery/toSyntheticCandidateFromAccount, ported into
// candidateSearch.routes.ts) actually populate - not the full monolith `jobs`/`candidates` row
// shape, since these are synthetic query/CandidateAccount-derived objects, never real DB rows.
// matching-scoring-service's own /internal/rank-candidates-for-job accepts this same shape.
export interface Job {
  required_skills: string[];
  location: string;
  title: string;
  description: string;
  experience_years: number;
}

export interface Candidate {
  skills: string[];
  years_of_experience: string | null;
  current_location: string | null;
  current_job_title: string | null;
  resume_text: string | null;
}

export interface RankedCandidate {
  candidate: Candidate;
  match_score: number;
}
