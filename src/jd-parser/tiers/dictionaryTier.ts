import { MultiPatternTrie } from '../matcher/trie.js';
import { SKILL_DICTIONARY, CATEGORY_TO_OUTPUT_FIELD } from '../dictionaries/skills.dictionary.js';
import { EDUCATION_DICTIONARY } from '../dictionaries/education.dictionary.js';
import { CERTIFICATIONS_DICTIONARY } from '../dictionaries/certifications.dictionary.js';
import { SPOKEN_LANGUAGES_DICTIONARY } from '../dictionaries/languages.dictionary.js';
import { LOCATIONS_DICTIONARY } from '../dictionaries/locations.dictionary.js';
import type { MatchedSkill, ParsedJobDescription } from '../types.js';

// Tries are built once at module load, not per-parse-call, per the "no unnecessary model
// loading" performance requirement - building a few-hundred-pattern trie is cheap, but there's
// still no reason to redo it on every single JD.
const skillsTrie = new MultiPatternTrie(SKILL_DICTIONARY);
const educationTrie = new MultiPatternTrie(EDUCATION_DICTIONARY);
const certificationsTrie = new MultiPatternTrie(CERTIFICATIONS_DICTIONARY);
const languagesTrie = new MultiPatternTrie(SPOKEN_LANGUAGES_DICTIONARY);
const locationsTrie = new MultiPatternTrie(LOCATIONS_DICTIONARY);

type SectionType = 'required' | 'optional' | 'responsibilities' | 'summary' | 'other';
interface Section { type: SectionType; text: string }

// Whole-line header patterns (tested against a single trimmed line at a time, so no /m flag
// needed - ^/$ already anchor to the full trimmed line).
const SECTION_HEADERS: { type: SectionType; regex: RegExp }[] = [
  { type: 'required', regex: /^(required skills?|must[ -]have skills?|key skills?|mandatory skills?|requirements?|qualifications?)\s*:?\s*$/i },
  { type: 'optional', regex: /^(preferred skills?|nice[ -]to[ -]have( skills?)?|good[ -]to[ -]have( skills?)?|bonus( points)?|plus points?|preferred qualifications?)\s*:?\s*$/i },
  { type: 'responsibilities', regex: /^(responsibilities|key responsibilities|roles?\s*(and|&)\s*responsibilities|what you.?ll do|duties)\s*:?\s*$/i },
  { type: 'summary', regex: /^(job summary|about the role|about this role|overview|role summary)\s*:?\s*$/i },
];

// A standalone "Label: value" line (e.g. "Location: Bangalore / Hybrid", "Notice Period: 30
// days") - these are single-line metadata fields, not section headers with a multi-line body
// and not responsibility bullets, so they must not be swept into whatever multi-line section
// (e.g. Responsibilities) happens to be open when they appear.
const METADATA_LINE_RE = /^[A-Za-z][A-Za-z\s]{1,30}:\s*\S.{0,120}$/;

// Section types whose body is expected to be multi-line prose/bullets - a metadata line
// encountered while one of these is open implicitly closes it, rather than being absorbed as
// if it were another bullet/sentence.
const MULTILINE_SECTION_TYPES: SectionType[] = ['required', 'optional', 'responsibilities', 'summary'];

// Splits a JD into labeled sections by scanning for known header lines (e.g. "Required Skills:",
// "Nice to Have:"). Text before the first recognized header (or the whole JD, if no headers are
// found at all) is labeled 'other' and is still scanned for required-section purposes by the
// caller, since many JDs list required skills without an explicit "Required" header at all.
export function splitIntoSections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let current: Section = { type: 'other', text: '' };

  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed ? SECTION_HEADERS.find((p) => p.regex.test(trimmed)) : undefined;

    if (header) {
      if (current.text.trim()) sections.push(current);
      current = { type: header.type, text: '' };
      continue;
    }

    const isBullet = /^[\s•\-*·▪◦]/.test(line);
    if (!isBullet && MULTILINE_SECTION_TYPES.includes(current.type) && METADATA_LINE_RE.test(trimmed)) {
      if (current.text.trim()) sections.push(current);
      current = { type: 'other', text: line + '\n' };
      continue;
    }

    current.text += line + '\n';
  }
  if (current.text.trim()) sections.push(current);
  return sections;
}

function matchSkills(text: string): MatchedSkill[] {
  const matches = skillsTrie.findAll(text);
  const seen = new Set<string>();
  const result: MatchedSkill[] = [];
  for (const m of matches) {
    const key = m.entry.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ canonical: m.entry.canonical, category: m.entry.category, matchedText: m.matchedText });
  }
  return result;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

export interface DictionaryTierResult {
  fields: Pick<
    ParsedJobDescription,
    | 'requiredSkills' | 'optionalSkills' | 'requiredTools' | 'requiredTechnologies'
    | 'requiredFrameworks' | 'requiredDatabases' | 'requiredCloudPlatforms' | 'requiredMethodologies'
    | 'education' | 'certifications' | 'requiredLanguages' | 'location'
  >;
  resolvedFields: string[]; // field names that got at least one value, for provenance tracking
}

export function runDictionaryTier(text: string): DictionaryTierResult {
  const sections = splitIntoSections(text);

  // "required" candidate text = every section EXCEPT ones explicitly marked 'optional' - most
  // JDs never bother with an explicit "Required" header at all, they just list skills, so
  // defaulting non-optional sections to the required bucket is the more useful behavior.
  const requiredText = sections.filter((s) => s.type !== 'optional').map((s) => s.text).join('\n');
  const optionalText = sections.filter((s) => s.type === 'optional').map((s) => s.text).join('\n');

  const requiredMatches = matchSkills(requiredText);
  const optionalMatchesRaw = matchSkills(optionalText);

  // A skill mentioned in both buckets counts as required only, so the two lists never overlap.
  const requiredCanonicals = new Set(requiredMatches.map((s) => s.canonical.toLowerCase()));
  const optionalMatches = optionalMatchesRaw.filter((s) => !requiredCanonicals.has(s.canonical.toLowerCase()));

  const categoryBuckets: Record<string, string[]> = {
    requiredTools: [], requiredTechnologies: [], requiredFrameworks: [],
    requiredDatabases: [], requiredCloudPlatforms: [], requiredMethodologies: [],
  };
  for (const skill of requiredMatches) {
    const field = CATEGORY_TO_OUTPUT_FIELD[skill.category];
    if (field) categoryBuckets[field].push(skill.canonical);
  }

  const education = dedupeStrings(educationTrie.findAll(text).map((m) => m.entry.canonical));
  const certifications = dedupeStrings(certificationsTrie.findAll(text).map((m) => m.entry.canonical));
  const requiredLanguages = dedupeStrings(languagesTrie.findAll(text).map((m) => m.entry.canonical));
  const location = dedupeStrings(locationsTrie.findAll(text).map((m) => m.entry.canonical));

  const resolvedFields: string[] = [];
  if (requiredMatches.length) resolvedFields.push('requiredSkills');
  if (optionalMatches.length) resolvedFields.push('optionalSkills');
  if (education.length) resolvedFields.push('education');
  if (certifications.length) resolvedFields.push('certifications');
  if (requiredLanguages.length) resolvedFields.push('requiredLanguages');
  if (location.length) resolvedFields.push('location');
  for (const [field, values] of Object.entries(categoryBuckets)) {
    if (values.length) resolvedFields.push(field);
  }

  return {
    fields: {
      requiredSkills: requiredMatches,
      optionalSkills: optionalMatches,
      requiredTools: dedupeStrings(categoryBuckets.requiredTools),
      requiredTechnologies: dedupeStrings(categoryBuckets.requiredTechnologies),
      requiredFrameworks: dedupeStrings(categoryBuckets.requiredFrameworks),
      requiredDatabases: dedupeStrings(categoryBuckets.requiredDatabases),
      requiredCloudPlatforms: dedupeStrings(categoryBuckets.requiredCloudPlatforms),
      requiredMethodologies: dedupeStrings(categoryBuckets.requiredMethodologies),
      education,
      certifications,
      requiredLanguages,
      location,
    },
    resolvedFields,
  };
}
