import { logger } from '../utils/logger.js';
import { runRegexTier } from './tiers/regexTier.js';
import { runDictionaryTier } from './tiers/dictionaryTier.js';
import { runStructuralTier } from './tiers/structuralTier.js';
import { runNlpTier } from './tiers/nlpTier.js';
import { validateAndNormalize } from './schema.js';
import type { FieldSource, JobDescriptionParseResult, MatchedSkill, ParsedJobDescription } from './types.js';

// Fields Tiers 1-2 (regex + dictionary/structural heuristics) can never resolve on their own -
// these are the only fields the NLP tier is asked for, and only when the cheap heuristic in
// structuralTier.ts came up empty for jobTitle/jobSummary/responsibilities. This is what keeps
// the average parse fast: a well-formed JD with clear section headers resolves entirely from
// Tiers 1-2 and never calls the Python service at all.
const NLP_ONLY_FIELDS = ['industry', 'department'] as const;

function deriveKeywords(parsed: Omit<ParsedJobDescription, 'keywords'>): string[] {
  const skillNames = (skills: MatchedSkill[]) => skills.map((s) => s.canonical);
  const all = [
    ...skillNames(parsed.requiredSkills),
    ...skillNames(parsed.optionalSkills),
    ...parsed.education,
    ...parsed.certifications,
    ...parsed.requiredTools,
    ...parsed.requiredTechnologies,
    ...parsed.requiredFrameworks,
    ...parsed.requiredDatabases,
    ...parsed.requiredCloudPlatforms,
    ...parsed.requiredMethodologies,
  ];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const term of all) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(term);
  }
  return keywords;
}

export interface ParseOptions {
  // Lets callers (e.g. the benchmark script) measure the Tier 1-2-only path in isolation.
  skipNlpTier?: boolean;
}

export async function parseJobDescription(rawText: string, options: ParseOptions = {}): Promise<JobDescriptionParseResult> {
  const startedAt = performance.now();
  const text = rawText.trim();

  if (!text) {
    throw new Error('parseJobDescription: input text is empty');
  }

  const fieldSources: FieldSource[] = [];
  const track = (fields: string[], tier: FieldSource['tier']) => {
    for (const field of fields) fieldSources.push({ field, tier });
  };

  const regexResult = runRegexTier(text);
  track(regexResult.resolvedFields, 'regex');

  const dictResult = runDictionaryTier(text);
  track(dictResult.resolvedFields, 'dictionary');

  const structResult = runStructuralTier(text);
  track(structResult.resolvedFields, 'regex');

  let nlpFields: Partial<ParsedJobDescription> = {};
  if (!options.skipNlpTier) {
    const neededFields: string[] = [...NLP_ONLY_FIELDS];
    if (!structResult.fields.jobTitle) neededFields.push('jobTitle');
    if (!structResult.fields.jobSummary) neededFields.push('jobSummary');
    if (structResult.fields.responsibilities.length === 0) neededFields.push('responsibilities');
    if (dictResult.fields.location.length === 0) neededFields.push('location');

    const nlpResult = await runNlpTier({ text, neededFields });
    nlpFields = nlpResult.fields;
    track(nlpResult.resolvedFields, 'nlp');
  }

  const merged: Omit<ParsedJobDescription, 'keywords'> = {
    jobTitle: structResult.fields.jobTitle ?? nlpFields.jobTitle ?? null,
    requiredSkills: dictResult.fields.requiredSkills,
    optionalSkills: dictResult.fields.optionalSkills,
    minimumExperience: regexResult.fields.minimumExperience,
    maximumExperience: regexResult.fields.maximumExperience,
    experienceUnit: regexResult.fields.experienceUnit,
    location: dictResult.fields.location.length ? dictResult.fields.location : (nlpFields.location ?? []),
    remoteType: regexResult.fields.remoteType,
    employmentType: regexResult.fields.employmentType,
    industry: nlpFields.industry ?? null,
    department: nlpFields.department ?? null,
    education: dictResult.fields.education,
    certifications: dictResult.fields.certifications,
    salaryMinimum: regexResult.fields.salaryMinimum,
    salaryMaximum: regexResult.fields.salaryMaximum,
    salaryCurrency: regexResult.fields.salaryCurrency,
    noticePeriod: regexResult.fields.noticePeriod,
    numberOfOpenings: regexResult.fields.numberOfOpenings,
    requiredLanguages: dictResult.fields.requiredLanguages,
    responsibilities: structResult.fields.responsibilities.length ? structResult.fields.responsibilities : (nlpFields.responsibilities ?? []),
    requiredTools: dictResult.fields.requiredTools,
    requiredTechnologies: dictResult.fields.requiredTechnologies,
    requiredFrameworks: dictResult.fields.requiredFrameworks,
    requiredDatabases: dictResult.fields.requiredDatabases,
    requiredCloudPlatforms: dictResult.fields.requiredCloudPlatforms,
    requiredMethodologies: dictResult.fields.requiredMethodologies,
    jobSummary: structResult.fields.jobSummary ?? nlpFields.jobSummary ?? null,
  };

  const keywords = deriveKeywords(merged);
  if (keywords.length) fieldSources.push({ field: 'keywords', tier: 'derived' });

  const candidate: ParsedJobDescription = { ...merged, keywords };
  const parsed = validateAndNormalize(candidate);

  const parseTimeMs = performance.now() - startedAt;
  logger.debug({ parseTimeMs, resolvedFieldCount: fieldSources.length }, 'JD parse complete');

  return { parsed, sourceText: rawText, fieldSources, parseTimeMs };
}
