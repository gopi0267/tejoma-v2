/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
}

export interface Company {
  id: number;
  name: string;
  industry: string;
  plan: 'starter' | 'pro' | 'enterprise';
  seats_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Candidate {
  id: number;
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
}

export interface Swipe {
  id: number;
  recruiter_id: number;
  candidate_id: number;
  job_id: number;
  action: 0 | 1 | 0.5; // 0=reject, 1=accept, 0.5=save
  match_score: number;
  timestamp: string;
  used_for_training: boolean;
}

export interface MatchScore {
  id: number;
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

