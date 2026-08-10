import type { EmploymentType, ExperienceUnit, ParsedJobDescription, RemoteType, SalaryCurrency } from '../types.js';

function normalizeUnit(u: string): ExperienceUnit {
  return /^mo/i.test(u) ? 'months' : 'years';
}

// Handles: "5 Years", "5+ Years", "5-8 Years", "Minimum 5 Years", "At least 4 Years",
// "3 to 6 Years" (and month equivalents of all the above).
export function extractExperience(text: string): Pick<ParsedJobDescription, 'minimumExperience' | 'maximumExperience' | 'experienceUnit'> {
  const unit = '(years?|yrs?|months?|mos?)';

  let m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:to|-|–|—)\\s*(\\d+(?:\\.\\d+)?)\\+?\\s*${unit}\\b`, 'i'));
  if (m) return { minimumExperience: parseFloat(m[1]), maximumExperience: parseFloat(m[2]), experienceUnit: normalizeUnit(m[3]) };

  m = text.match(new RegExp(`\\b(?:minimum|min\\.?|at least)\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`, 'i'));
  if (m) return { minimumExperience: parseFloat(m[1]), maximumExperience: null, experienceUnit: normalizeUnit(m[2]) };

  m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*\\+\\s*${unit}\\b`, 'i'));
  if (m) return { minimumExperience: parseFloat(m[1]), maximumExperience: null, experienceUnit: normalizeUnit(m[2]) };

  m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`, 'i'));
  if (m) {
    const v = parseFloat(m[1]);
    return { minimumExperience: v, maximumExperience: v, experienceUnit: normalizeUnit(m[2]) };
  }

  return { minimumExperience: null, maximumExperience: null, experienceUnit: null };
}

function resolveCurrencySymbol(sym: string): SalaryCurrency {
  const s = sym.toLowerCase();
  if (s === 'eur' || s === '€') return 'EUR';
  if (s === 'gbp' || s === '£') return 'GBP';
  return 'USD';
}

function parseScaledNumber(numStr: string, kSuffix: string | undefined): number {
  const n = parseFloat(numStr.replace(/,/g, ''));
  return kSuffix ? n * 1000 : n;
}

// Handles: "12 LPA", "10-15 LPA", "₹18 Lakhs", "USD 120000", "$80K" (and ranges/EUR/GBP
// equivalents of the currency forms). LPA/Lakhs always implies INR; the Indian Lakhs scale
// (1 Lakh = 100,000) is applied so the stored value is a real annual amount, not the raw "12".
export function extractSalary(text: string): Pick<ParsedJobDescription, 'salaryMinimum' | 'salaryMaximum' | 'salaryCurrency'> {
  let m = text.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)\b/i);
  if (m) return { salaryMinimum: parseFloat(m[1]) * 100000, salaryMaximum: parseFloat(m[2]) * 100000, salaryCurrency: 'INR' };

  m = text.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)\b/i);
  if (m) {
    const v = parseFloat(m[1]) * 100000;
    return { salaryMinimum: v, salaryMaximum: v, salaryCurrency: 'INR' };
  }

  m = text.match(/(usd|eur|gbp|\$|€|£)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k)?\s*(?:-|to|–|—)\s*(?:usd|eur|gbp|\$|€|£)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k)?/i);
  if (m) {
    return {
      salaryMinimum: parseScaledNumber(m[2], m[3]),
      salaryMaximum: parseScaledNumber(m[4], m[5]),
      salaryCurrency: resolveCurrencySymbol(m[1]),
    };
  }

  m = text.match(/(usd|eur|gbp|\$|€|£)\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k)?/i);
  if (m) {
    const v = parseScaledNumber(m[2], m[3]);
    return { salaryMinimum: v, salaryMaximum: v, salaryCurrency: resolveCurrencySymbol(m[1]) };
  }

  return { salaryMinimum: null, salaryMaximum: null, salaryCurrency: null };
}

export function extractNoticePeriod(text: string): string | null {
  let m = text.match(/notice period\s*:?\s*(immediate(?:ly)?(?: joiners?)?|\d+\s*(?:-\s*\d+\s*)?(?:days?|weeks?|months?)|less than \d+\s*(?:days?|months?))/i);
  if (m) return m[1].replace(/\s+/g, ' ').trim();

  m = text.match(/\bimmediate joiners?\b/i);
  if (m) return 'Immediate';

  return null;
}

export function extractNumberOfOpenings(text: string): number | null {
  let m = text.match(/(\d+)\s*(?:openings?|positions?|vacanc(?:y|ies)|headcounts?)\b/i);
  if (m) return parseInt(m[1], 10);

  m = text.match(/(?:openings?|positions?|vacanc(?:y|ies))\s*:?\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);

  return null;
}

const EMPLOYMENT_TYPE_PATTERNS: [RegExp, EmploymentType][] = [
  [/\bpart[ -]?time\b/i, 'part-time'],
  [/\bfull[ -]?time\b/i, 'full-time'],
  [/\bcontract(?:ual)?(?:[ -]to[ -]hire)?\b/i, 'contract'],
  [/\bintern(?:ship)?\b/i, 'internship'],
  [/\bfreelance(?:r)?\b/i, 'freelance'],
  [/\btemporary\b|\btemp\b/i, 'temporary'],
];

export function extractEmploymentType(text: string): EmploymentType | null {
  for (const [re, type] of EMPLOYMENT_TYPE_PATTERNS) {
    if (re.test(text)) return type;
  }
  return null;
}

// Order matters: "hybrid" is checked first since it's the most specific/unambiguous term;
// "onsite" last since it's often the unstated default and shows up in incidental phrases
// ("on-site interview") that shouldn't override an explicit remote/hybrid mention elsewhere.
export function extractRemoteType(text: string): RemoteType | null {
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\b(?:fully\s+)?remote\b|\bwork from home\b|\bwfh\b/i.test(text)) return 'remote';
  if (/\bon[ -]?site\b|\bin[ -]?office\b/i.test(text)) return 'onsite';
  return null;
}

export interface RegexTierResult {
  fields: Pick<
    ParsedJobDescription,
    | 'minimumExperience' | 'maximumExperience' | 'experienceUnit'
    | 'salaryMinimum' | 'salaryMaximum' | 'salaryCurrency'
    | 'noticePeriod' | 'numberOfOpenings' | 'employmentType' | 'remoteType'
  >;
  resolvedFields: string[];
}

export function runRegexTier(text: string): RegexTierResult {
  const experience = extractExperience(text);
  const salary = extractSalary(text);
  const noticePeriod = extractNoticePeriod(text);
  const numberOfOpenings = extractNumberOfOpenings(text);
  const employmentType = extractEmploymentType(text);
  const remoteType = extractRemoteType(text);

  const fields = { ...experience, ...salary, noticePeriod, numberOfOpenings, employmentType, remoteType };
  const resolvedFields = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k]) => k);

  return { fields, resolvedFields };
}
