// This service's own DB-row shape for `candidates` - mirrors the monolith's RAW stored
// representation exactly (skills/previous_companies/certifications as delimited strings, not
// parsed arrays - the monolith's own mapRowToCandidate does that parsing at its own read
// boundary). As of remaining-monolith migration Step 3a, this service's own public GET routes
// apply the same parsing (db.ts's own ported mapRowToCandidate) before responding - see that
// file's header comment for why a real, previously-latent shape mismatch made this necessary.

export interface CandidateRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  skills: string | null;
  primary_skills: string | null;
  secondary_skills: string | null;
  skills_array: string[] | null;
  years_of_experience: string | null;
  current_location: string | null;
  preferred_location: string | null;
  current_company: string | null;
  previous_companies: string | null;
  current_job_title: string | null;
  industry_domain: string | null;
  education: string | null;
  highest_qualification: string | null;
  graduation_year: string | null;
  university: string | null;
  certifications: string | null;
  projects: string | null;
  technical_tools: string | null;
  languages_known: string | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  notice_period: string | null;
  willingness_to_relocate: string | null;
  linkedin_url: string | null;
  github_or_portfolio_url: string | null;
  resume_summary: string | null;
  resume_text: string | null;
  ai_confidence_score: string | null;
  created_at: string;
  updated_at: string;
  extraction_status: string | null;
  resume_file_path: string | null;
  candidate_hash: string | null;
  resume_embedding: number[] | null;
  company_id: number;
  candidate_account_id: number | null;
  confidence_profile: Record<string, unknown> | null;
  skills_embedding: number[] | null;
  responsibilities_embedding: number[] | null;
  title_embedding: number[] | null;
  work_history: unknown | null;
  project_entries: unknown | null;
  project_intelligence: unknown | null;
}

// The parsed shape (skills/previous_companies/certifications as real string[]) - what
// db.ts's mapRowToCandidate produces from a CandidateRow, and what the monolith's own
// /internal/candidate-core write-proxy endpoints already return (its own db.createCandidate
// applies the identical parsing before responding). This service's public GET/POST/DELETE routes
// all deal in this shape, matching the monolith's original API contract exactly.
export interface Candidate extends Omit<CandidateRow, 'skills' | 'previous_companies' | 'certifications' | 'skills_array'> {
  skills: string[];
  previous_companies: string[];
  certifications: string[];
}
