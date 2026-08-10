// Ported from the monolith's src/types.ts - Job only, byte-identical shape.

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

// Trimmed to what GET /api/jobs/:id's real cutover actually needs - the parsed shape
// candidate-core-service's own /internal/candidates/for-job-scoring already returns (real
// arrays, not delimited strings - see that service's db.ts's mapRowToCandidate).
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
