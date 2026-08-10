/**
 * Ported from the monolith's src/api/job.routes.ts (write-cutover completion plan, Phase B) - the
 * exact same field normalization createJobWithSideEffects/updateJobWithSideEffects always applied
 * before their INSERT/UPDATE, now run here since this service performs the real write itself.
 */
export const toStringArray = (val: any): string[] => {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

export interface JobCreatePayload {
  company_id: number;
  title: string;
  description: string;
  required_skills: string[];
  experience_years: number;
  location: string;
  salary_min: number;
  salary_max: number;
  status: 'open';
  optional_skills: string[];
  min_experience: number | null;
  max_experience: number | null;
  experience_unit: 'years' | 'months' | null;
  remote_type: 'remote' | 'hybrid' | 'onsite' | null;
  employment_type: string | null;
  industry: string | null;
  department: string | null;
  education: string[];
  certifications: string[];
  salary_currency: string | null;
  notice_period: string | null;
  number_of_openings: number | null;
  required_languages: string[];
  responsibilities: string[];
  tech_stack: Record<string, unknown>;
  keywords: string[];
  job_summary: string | null;
  source_raw_text: string | null;
  parse_confidence: Record<string, unknown>;
}

// Returns 'invalid' (not a thrown error) when required fields are missing, matching the
// original route's own "Missing required job creation parameters" 400 - the caller decides how
// to surface that.
export function jobPayloadFromBody(companyId: number, body: any): JobCreatePayload | 'invalid' {
  const {
    title, description, required_skills, experience_years, location, salary_min, salary_max,
    optional_skills, min_experience, max_experience, experience_unit, remote_type, employment_type,
    industry, department, education, certifications, salary_currency, notice_period,
    number_of_openings, required_languages, responsibilities, tech_stack, keywords, job_summary,
    source_raw_text, parse_confidence,
  } = body;
  if (!title || !description || !required_skills) {
    return 'invalid';
  }

  return {
    company_id: companyId,
    title,
    description,
    required_skills: toStringArray(required_skills),
    experience_years: experience_years || 0,
    location: location || 'Remote',
    salary_min: salary_min || 0,
    salary_max: salary_max || 0,
    status: 'open',
    optional_skills: toStringArray(optional_skills),
    min_experience: min_experience ?? null,
    max_experience: max_experience ?? null,
    experience_unit: experience_unit ?? null,
    remote_type: remote_type ?? null,
    employment_type: employment_type ?? null,
    industry: industry ?? null,
    department: department ?? null,
    education: toStringArray(education),
    certifications: toStringArray(certifications),
    salary_currency: salary_currency ?? null,
    notice_period: notice_period ?? null,
    number_of_openings: number_of_openings ?? null,
    required_languages: toStringArray(required_languages),
    responsibilities: toStringArray(responsibilities),
    tech_stack: tech_stack ?? {},
    keywords: toStringArray(keywords),
    job_summary: job_summary ?? null,
    source_raw_text: source_raw_text ?? null,
    parse_confidence: parse_confidence ?? {},
  };
}

export interface JobUpdatePayload {
  title?: string;
  description?: string;
  required_skills?: string[];
  experience_years?: number;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  status?: 'open' | 'closed' | 'on_hold';
}

export function jobUpdatePayloadFromBody(body: any): JobUpdatePayload {
  const { title, description, required_skills, experience_years, location, salary_min, salary_max, status } = body;
  return {
    title,
    description,
    required_skills: required_skills !== undefined ? toStringArray(required_skills) : undefined,
    experience_years,
    location,
    salary_min,
    salary_max,
    status,
  };
}
