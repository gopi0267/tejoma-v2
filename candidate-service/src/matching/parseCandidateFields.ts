/**
 * Candidate field parsing utilities for analytics scoring
 * Ported from monolith src/matching/parseCandidateFields.ts
 */

// Simplified salary extraction - handles common formats like "12 LPA", "20-25 LPA", "$80K", etc.
function extractSalary(raw: string): { salaryMinimum: number | null; salaryMaximum: number | null } {
  if (!raw) return { salaryMinimum: null, salaryMaximum: null };

  const text = String(raw).toUpperCase();

  // Handle LPA (Lakhs Per Annum) format
  const lpaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*-?\s*(\d+(?:[.,]\d+)?)?.*LPA/);
  if (lpaMatch) {
    const min = parseFloat(lpaMatch[1].replace(',', ''));
    const max = lpaMatch[2] ? parseFloat(lpaMatch[2].replace(',', '')) : min;
    // Convert LPA to base salary (1 LPA = 100,000)
    return { salaryMinimum: min * 100000, salaryMaximum: max * 100000 };
  }

  // Handle USD format (e.g., "$80K", "$80,000-$100,000")
  const usdMatch = text.match(/\$(\d+(?:[.,]\d+)?)\s*K?(?:\s*-\s*\$?(\d+(?:[.,]\d+)?)\s*K?)?/);
  if (usdMatch) {
    let min = parseFloat(usdMatch[1].replace(',', ''));
    if (usdMatch[1].includes('K') || /K\b/.test(text)) min *= 1000;
    let max = min;
    if (usdMatch[2]) {
      max = parseFloat(usdMatch[2].replace(',', ''));
      if (usdMatch[2].includes('K') || /K\b/.test(text)) max *= 1000;
    }
    return { salaryMinimum: min, salaryMaximum: max };
  }

  // Handle bare numbers (with optional K suffix)
  const numMatch = text.match(/(\d+(?:[.,]\d+)?)\s*K?\s*(?:-\s*(\d+(?:[.,]\d+)?)\s*K?)?/);
  if (numMatch) {
    let min = parseFloat(numMatch[1].replace(',', ''));
    if (/K\b/.test(text)) min *= 1000;
    let max = min;
    if (numMatch[2]) {
      max = parseFloat(numMatch[2].replace(',', ''));
      if (/K\b/.test(text)) max *= 1000;
    }
    return { salaryMinimum: min, salaryMaximum: max };
  }

  return { salaryMinimum: null, salaryMaximum: null };
}

// Parses free-text years of experience (e.g., "6+ years", "5-8 years", "3.10 years")
export function parseExperienceYears(raw: string | null | undefined): number {
  if (!raw) return 0;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

// Parses free-text salary value (e.g., "12 LPA", "$80K")
export function parseSalaryValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const { salaryMinimum, salaryMaximum } = extractSalary(raw);
  if (salaryMinimum === null && salaryMaximum === null) return null;
  if (salaryMinimum !== null && salaryMaximum !== null) return (salaryMinimum + salaryMaximum) / 2;
  return salaryMinimum ?? salaryMaximum;
}

// Resolves candidate's salary expectation from expected_ctc or current_ctc
export function resolveCandidateSalaryExpectation(candidate: { expected_ctc?: string | null; current_ctc?: string | null }): number | null {
  return parseSalaryValue(candidate.expected_ctc) ?? parseSalaryValue(candidate.current_ctc);
}
