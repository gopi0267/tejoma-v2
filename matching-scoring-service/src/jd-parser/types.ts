// Core types for the JD (Job Description) parsing pipeline.
// Every extracted field is nullable/empty by design - the pipeline must never invent a value it
// didn't actually find (see AGENTS/spec: "Never hallucinate or invent values").

export type ExtractionTier = 'regex' | 'dictionary' | 'nlp' | 'gliner' | 'derived';

export type ExperienceUnit = 'years' | 'months';
export type RemoteType = 'remote' | 'hybrid' | 'onsite';
export type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'internship' | 'freelance' | 'temporary';
export type SalaryCurrency = 'INR' | 'USD' | 'EUR' | 'GBP';

export type SkillCategory =
  | 'programming_language'
  | 'frontend_framework'
  | 'backend_framework'
  | 'database'
  | 'cloud'
  | 'devops'
  | 'testing'
  | 'messaging'
  | 'operating_system'
  | 'ai_ml'
  | 'data_engineering'
  | 'tool'
  | 'library'
  | 'methodology'
  | 'architecture'
  | 'security'
  | 'design'
  | 'soft_skill'
  | 'general';

// A single dictionary-matched skill, keeping the original matched text for auditing per spec.
export interface MatchedSkill {
  canonical: string;
  category: SkillCategory;
  matchedText: string;
}

// Per-field provenance - which tier resolved this field, used for the parse_confidence audit
// column and for deciding whether the (optional) NLP tier needs to run at all for a given JD.
export interface FieldSource {
  field: string;
  tier: ExtractionTier;
}

export interface ParsedJobDescription {
  jobTitle: string | null;
  requiredSkills: MatchedSkill[];
  optionalSkills: MatchedSkill[];
  minimumExperience: number | null;
  maximumExperience: number | null;
  experienceUnit: ExperienceUnit | null;
  location: string[];
  remoteType: RemoteType | null;
  employmentType: EmploymentType | null;
  industry: string | null;
  department: string | null;
  education: string[];
  certifications: string[];
  salaryMinimum: number | null;
  salaryMaximum: number | null;
  salaryCurrency: SalaryCurrency | null;
  noticePeriod: string | null;
  numberOfOpenings: number | null;
  requiredLanguages: string[];
  responsibilities: string[];
  requiredTools: string[];
  requiredTechnologies: string[];
  requiredFrameworks: string[];
  requiredDatabases: string[];
  requiredCloudPlatforms: string[];
  requiredMethodologies: string[];
  keywords: string[];
  jobSummary: string | null;
}

// Wraps the parsed result with the raw input and per-field provenance, for the API response and
// the `parse_confidence` jsonb audit column.
export interface JobDescriptionParseResult {
  parsed: ParsedJobDescription;
  sourceText: string;
  fieldSources: FieldSource[];
  parseTimeMs: number;
}
