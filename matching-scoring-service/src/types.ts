// Trimmed local copy of the monolith's src/types.ts - only the shapes this service's ported
// scoring pipeline (src/matching/services.ts, computeMatchFeatures + calculateMatchScoresBatch/
// calculateMatchScoresForJobsBatch) actually reads. Sourced field-for-field from the monolith's
// own Candidate/Job/MatchBreakdown so a request body from the monolith deserializes identically.

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
  description_embedding?: number[] | null;
}

// Trimmed to only the fields toSyntheticCandidateFromAccount (matching/matchingApi.ts) reads.
export interface CandidateAccount {
  skills: string[] | null;
  years_of_experience: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
}

export interface MatchScore {
  id: number;
  company_id: number;
  job_id: number;
  candidate_id: number;
  feature_score: number;
  embedding_score: number;
  ml_score: number;
  final_score: number;
  rank: number;
  created_at: string;
}

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
