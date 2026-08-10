import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ParsedJobDescription } from './types.js';

const SkillCategorySchema = z.enum([
  'programming_language', 'frontend_framework', 'backend_framework', 'database', 'cloud',
  'devops', 'testing', 'messaging', 'operating_system', 'ai_ml', 'data_engineering', 'tool',
  'library', 'methodology', 'architecture', 'security', 'design', 'soft_skill', 'general',
]);

const MatchedSkillSchema = z.object({
  canonical: z.string().min(1),
  category: SkillCategorySchema,
  matchedText: z.string().min(1),
});

// Every field is nullable/optional-with-empty-default by design - the parser must be able to
// return "I don't know" for any field rather than being forced to invent a value.
export const ParsedJobDescriptionSchema = z
  .object({
    jobTitle: z.string().min(1).nullable(),
    requiredSkills: z.array(MatchedSkillSchema).default([]),
    optionalSkills: z.array(MatchedSkillSchema).default([]),
    minimumExperience: z.number().min(0).max(60).nullable(),
    maximumExperience: z.number().min(0).max(60).nullable(),
    experienceUnit: z.enum(['years', 'months']).nullable(),
    location: z.array(z.string().min(1)).default([]),
    remoteType: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
    employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance', 'temporary']).nullable(),
    industry: z.string().min(1).nullable(),
    department: z.string().min(1).nullable(),
    education: z.array(z.string().min(1)).default([]),
    certifications: z.array(z.string().min(1)).default([]),
    salaryMinimum: z.number().min(0).nullable(),
    salaryMaximum: z.number().min(0).nullable(),
    salaryCurrency: z.enum(['INR', 'USD', 'EUR', 'GBP']).nullable(),
    noticePeriod: z.string().min(1).nullable(),
    numberOfOpenings: z.number().int().min(0).nullable(),
    requiredLanguages: z.array(z.string().min(1)).default([]),
    responsibilities: z.array(z.string().min(1)).default([]),
    requiredTools: z.array(z.string().min(1)).default([]),
    requiredTechnologies: z.array(z.string().min(1)).default([]),
    requiredFrameworks: z.array(z.string().min(1)).default([]),
    requiredDatabases: z.array(z.string().min(1)).default([]),
    requiredCloudPlatforms: z.array(z.string().min(1)).default([]),
    requiredMethodologies: z.array(z.string().min(1)).default([]),
    keywords: z.array(z.string().min(1)).default([]),
    jobSummary: z.string().min(1).nullable(),
  })
  // Cross-field consistency checks - reject malformed/contradictory extractions rather than
  // silently persisting them (spec: "Reject invalid values", "Never allow malformed JSON").
  .refine(
    (v) => v.minimumExperience === null || v.maximumExperience === null || v.minimumExperience <= v.maximumExperience,
    { message: 'minimumExperience must be <= maximumExperience', path: ['minimumExperience'] }
  )
  .refine(
    (v) => v.salaryMinimum === null || v.salaryMaximum === null || v.salaryMinimum <= v.salaryMaximum,
    { message: 'salaryMinimum must be <= salaryMaximum', path: ['salaryMinimum'] }
  );

export class JobDescriptionValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super(`JD parse result failed validation: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'JobDescriptionValidationError';
  }
}

// Validates and returns a clean ParsedJobDescription, or throws a JobDescriptionValidationError
// with the exact field-level issues - callers must not swallow this into a generic 500, so a
// malformed pipeline result is loud and debuggable rather than silently reaching the database.
export function validateAndNormalize(raw: unknown): ParsedJobDescription {
  const result = ParsedJobDescriptionSchema.safeParse(raw);
  if (!result.success) {
    logger.error({ issues: result.error.issues }, 'JD parse validation failed');
    throw new JobDescriptionValidationError(result.error.issues);
  }
  return result.data as ParsedJobDescription;
}
