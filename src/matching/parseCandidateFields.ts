import { extractSalary } from '../jd-parser/tiers/regexTier.js';

// candidates.years_of_experience is stored as free text (e.g. "6+ years", "5-8 years", "3.10
// years") - not a number, which is exactly why the old `typeof candidate.years_of_experience
// === 'number'` check in the matching engine silently always failed. This extracts the first
// number found as a representative value (for a range like "5-8 years", that's the lower bound -
// a conservative choice for matching, since it's the years a candidate can be confident they have).
export function parseExperienceYears(raw: string | null | undefined): number {
  if (!raw) return 0;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

// candidates.expected_ctc/current_ctc are free text too (e.g. "12 LPA", "20-25 LPA", "$80K") -
// there never was a `salary_expectation` numeric field on Candidate (the old code's reference to
// it was a phantom that silently fell back to a hardcoded default every time). Reuses the JD
// parser's already-tested salary regex (handles LPA/Lakhs/USD/K formats) since extracting a
// number from a free-text salary string is the exact same problem in both places.
export function parseSalaryValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const { salaryMinimum, salaryMaximum } = extractSalary(String(raw));
  if (salaryMinimum === null && salaryMaximum === null) return null;
  if (salaryMinimum !== null && salaryMaximum !== null) return (salaryMinimum + salaryMaximum) / 2;
  return salaryMinimum ?? salaryMaximum;
}

// Prefers expected_ctc (what the candidate wants) over current_ctc (what they have) as the
// figure to compare against a job's salary range - falls back to current_ctc only if expected
// isn't stated.
export function resolveCandidateSalaryExpectation(candidate: { expected_ctc?: string | null; current_ctc?: string | null }): number | null {
  return parseSalaryValue(candidate.expected_ctc) ?? parseSalaryValue(candidate.current_ctc);
}
