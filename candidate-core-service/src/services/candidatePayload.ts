/**
 * Ported from the monolith's src/api/candidate.routes.ts (write-cutover completion plan, Phase A)
 * - the exact same field-normalization the monolith's own createCandidateWithSideEffects always
 * applied before its INSERT, now run here since this service performs the real INSERT itself.
 * Every field is stored as VARCHAR/TEXT in the DB (see migration-31-cols.sql) - list fields
 * (skills, previous_companies, certifications) are just arrays of strings joined with a
 * separator. Coercing years_of_experience/willingness_to_relocate etc. to Number/boolean here
 * was silently destroying real extracted data (e.g. "6+ years" -> 0) before it ever reached the
 * database, so every field below is passed through as-is instead - unchanged from the original.
 */
import { computeCandidateConfidence } from './confidenceService.js';
import type { Candidate } from '../types.js';

const toArray = (val: any): string[] => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(/[,;]/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'null');
  return [];
};
const toText = (val: any): string => {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  return s.toLowerCase() === 'null' ? '' : s;
};

export type CandidateCreatePayload = Omit<Candidate, 'id' | 'created_at' | 'updated_at' | 'candidate_account_id' | 'skills_embedding' | 'responsibilities_embedding' | 'title_embedding' | 'project_intelligence'>;

export function candidatePayloadFromExtracted(cand: Partial<Candidate>, companyId: number): CandidateCreatePayload {
  const skills = toArray(cand.skills);
  const years_of_experience = toText(cand.years_of_experience);
  const resume_text = toText(cand.resume_text) || `${toText(cand.name)} - ${toText(cand.current_job_title)}`;
  const highest_qualification = toText(cand.highest_qualification);
  const university = toText(cand.university);
  const graduation_year = toText(cand.graduation_year);
  const projects = toText(cand.projects);
  const ai_confidence_score = toText(cand.ai_confidence_score);
  const extraction_status = cand.extraction_status || 'Complete';

  return {
    company_id: companyId,
    name: toText(cand.name),
    email: toText(cand.email),
    phone: toText(cand.phone),
    skills,
    primary_skills: toText(cand.primary_skills),
    secondary_skills: toText(cand.secondary_skills),
    years_of_experience,
    current_location: toText(cand.current_location),
    preferred_location: toText(cand.preferred_location),
    current_company: toText(cand.current_company),
    previous_companies: toArray(cand.previous_companies),
    current_job_title: toText(cand.current_job_title),
    industry_domain: toText(cand.industry_domain),
    education: toText(cand.education),
    highest_qualification,
    graduation_year,
    university,
    certifications: toArray(cand.certifications),
    projects,
    technical_tools: toText(cand.technical_tools),
    languages_known: toText(cand.languages_known),
    current_ctc: toText(cand.current_ctc),
    expected_ctc: toText(cand.expected_ctc),
    notice_period: toText(cand.notice_period),
    willingness_to_relocate: toText(cand.willingness_to_relocate),
    linkedin_url: toText(cand.linkedin_url),
    github_or_portfolio_url: toText(cand.github_or_portfolio_url),
    resume_summary: toText(cand.resume_summary),
    resume_text,
    ai_confidence_score,
    extraction_status,
    resume_file_path: cand.resume_file_path ?? null,
    candidate_hash: cand.candidate_hash ?? null,
    resume_embedding: cand.resume_embedding ?? null,
    confidence_profile: computeCandidateConfidence({
      skills, years_of_experience, resume_text, highest_qualification, university,
      graduation_year, projects, ai_confidence_score, extraction_status,
    }) as unknown as Record<string, unknown>,
    work_history: Array.isArray(cand.work_history) ? cand.work_history : undefined,
    project_entries: Array.isArray(cand.project_entries) ? cand.project_entries : undefined,
  } as CandidateCreatePayload;
}
