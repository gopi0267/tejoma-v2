// Minimal shapes for the fields src/rag.service.ts's buildCandidateChunk/buildJobChunk actually
// read - these arrive as JSON from the monolith's /internal/chat/* API (services/monolithClient.ts),
// not from this service's own database, so only the fields the chunk builders use are declared.

export interface CandidateForChunk {
  id: number;
  company_id: number;
  name: string | null;
  current_job_title?: string | null;
  current_company?: string | null;
  years_of_experience?: string | null;
  skills?: string[] | null;
  primary_skills?: string | null;
  industry_domain?: string | null;
  current_location?: string | null;
  preferred_location?: string | null;
  previous_companies?: string[] | null;
  highest_qualification?: string | null;
  university?: string | null;
  graduation_year?: string | null;
  certifications?: string[] | null;
  current_ctc?: string | null;
  expected_ctc?: string | null;
  notice_period?: string | null;
  willingness_to_relocate?: string | null;
  resume_summary?: string | null;
}

export interface JobForChunk {
  id: number;
  company_id: number;
  title: string;
  status?: string | null;
  experience_years?: number | null;
  required_skills?: string[] | null;
  location?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  description?: string | null;
}

export interface KnowledgeChunk {
  id: number;
  company_id: number | null;
  source_type: 'candidate' | 'job' | 'company';
  source_id: number;
  content: string;
  embedding: number[];
  created_at: string;
  updated_at: string;
}
